import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { validatePurposeRules, mergeStudio } from '../src/tools/purposes.ts';

// Imita a API de finalidades do gcc. Cada teste define `rotas`; tudo o que chega
// fica em `chamadas` para o teste conferir método, caminho, corpo e Bearer.
type Chamada = { method: string; url: string; body: any; auth: string | undefined };
type Rota = (c: Chamada) => { status: number; body?: unknown } | undefined;

let http: Server;
let base: string;
let chamadas: Chamada[] = [];
const historico: Chamada[] = [];
let rotas: Rota = () => undefined;
let dir: string;
let credPath: string;

before(async () => {
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const chamada: Chamada = {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        body: raw ? JSON.parse(raw) : undefined,
        auth: req.headers['authorization'] as string | undefined,
      };
      chamadas.push(chamada);
      historico.push(chamada);
      const r = rotas(chamada) ?? { status: 404, body: { detail: 'rota não mockada' } };
      res.setHeader('content-type', 'application/json');
      res.writeHead(r.status);
      res.end(r.body === undefined ? '' : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  dir = await mkdtemp(join(tmpdir(), 'hocguard-purposes-'));
  credPath = join(dir, 'credentials.json');
});

after(async () => {
  http.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  chamadas = [];
  rotas = () => undefined;
  await login('gcc:purposes:read gcc:purposes:write');
});

async function login(scope: string, expiresAt = Date.now() + 3_600_000) {
  await writeFile(credPath, JSON.stringify({ access_token: 'jwt-do-usuario', expires_at: expiresAt, scope }));
}

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({
    apiUrl: 'http://127.0.0.1:1', tenant: 'public', requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined,
    authUrl: base, credentialsPath: credPath,
  });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

function texto(result: unknown) {
  return (result as { content: { text: string }[] }).content[0]!.text;
}
function isError(result: unknown) {
  return (result as { isError?: boolean }).isError === true;
}

const STUDIO = {
  title: 'Newsletter',
  description: 'Envio de novidades',
  text: 'Quero receber novidades',
  identifier: 'email',
  extra_do_studio: 'manter',
  contexts: [
    { law: 'br', basis: 'consent', scope: 'Visitantes do site', rationale: 'Opt-in explícito', retention: 365, starts: 'cadastro', points: ['form-newsletter'], sensitive: false, minors: false },
    { law: 'eu', basis: 'consent', scope: 'Visitantes da UE', rationale: 'Art. 6(1)(a)', retention: 180, points: ['form-eu'] },
  ],
};

// Rascunho padrão é proposta deste client (guard-mcp); a tela não grava proposta.
const PROPOSTA_MCP = { canal: 'mcp', cliente: 'guard-mcp', agente: 'Claude Code', resumo: 'r', em: '2026-09-28T14:03:11.000Z' };

function versao(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, version_number: status === 'draft' ? 2 : 1, status, legal_basis: 'consent', retention_days: 365,
    grouping_identifier: 'email', consent_text: 'Quero receber novidades', etag: `etag-${id}`,
    config: {
      purpose_studio: structuredClone(STUDIO), outro_config: { x: 1 },
      ...(status === 'draft' ? { proposta: PROPOSTA_MCP } : {}),
    },
    published_at: status === 'published' ? '2026-09-01' : null,
    ...extra,
  };
}

function rascunhoDaTela(id: string) {
  return versao(id, 'draft', { config: { purpose_studio: structuredClone(STUDIO) } });
}

const LI_OK = {
  title: 'Prevenção a fraude', description: 'Detectar fraude no checkout', consent_text: 'Usamos seus dados para evitar fraude',
  legal_basis: 'legitimate_interest', lia_interest: 'Evitar fraude', lia_necessity: 'Sem meio menos invasivo',
  lia_balance: 'Expectativa razoável', lia_opt_out: 'E-mail para dpo@x', lia_conclusion: 'favoravel',
};

// --- validação local ---------------------------------------------------------

test('validação local: LI + sensível recusa sugerindo consentimento', () => {
  const p = validatePurposeRules({ basis: 'legitimate_interest', sensitive: true, lia: {} });
  assert.equal(p.length, 1);
  assert.match(p[0]!, /consentimento/);
});

test('validação local: LI exige as 3 fases e opt-out; desfavorável recusa; consentimento passa', () => {
  const p = validatePurposeRules({ basis: 'legitimate_interest', sensitive: false, lia: { interest: 'x' } });
  assert.match(p.join(' '), /lia_necessity/);
  assert.match(p.join(' '), /lia_balance/);
  assert.match(p.join(' '), /lia_opt_out/);
  assert.doesNotMatch(p.join(' '), /lia_interest \(/);
  const d = validatePurposeRules({ basis: 'legitimate_interest', sensitive: false, lia: { interest: 'a', necessity: 'b', balance: 'c', opt_out: 'd', conclusion: 'desfavoravel' } });
  assert.match(d.join(' '), /desfavorável/);
  assert.deepEqual(validatePurposeRules({ basis: 'consent', sensitive: true, lia: undefined }), []);
});

test('mergeStudio preserva contextos, pontos e campos que o agente não mandou', () => {
  const { studio, context } = mergeStudio(structuredClone(STUDIO), { law: 'eu', rationale: 'nova', lia_opt_out: 'link' });
  assert.equal(studio['extra_do_studio'], 'manter');
  assert.equal(studio.title, 'Newsletter');
  assert.equal(studio.contexts!.length, 2);
  assert.deepEqual(studio.contexts![0], STUDIO.contexts[0]);
  assert.equal(context!.rationale, 'nova');
  assert.deepEqual(context!.points, ['form-eu']);
  assert.equal(context!.lia!.opt_out, 'link');
});

// --- sem login / permissão -----------------------------------------------------

test('sem login: orienta guard_login com os scopes de finalidade e não chama a API', async () => {
  await rm(credPath, { force: true });
  const c = await client();
  const r = await c.callTool({ name: 'guard_list_purposes', arguments: {} });
  assert.ok(isError(r));
  assert.match(texto(r), /guard_login/);
  assert.match(texto(r), /gcc:purposes:read gcc:purposes:write/);
  assert.equal(chamadas.length, 0);
  await c.close();
});

test('guard_login pede por padrão os scopes de finalidade', async () => {
  const c = await client();
  const { tools } = await c.listTools();
  const login = tools.find((t) => t.name === 'guard_login')!;
  const scope = (login.inputSchema.properties as Record<string, { default?: string }>)['scope']!;
  assert.equal(scope.default, 'scan generate gcc:purposes:read gcc:purposes:write');
  await c.close();
});

test('token sem write: escrita explica que o papel não permite, sem chamar a API', async () => {
  await login('scan generate gcc:purposes:read');
  const c = await client();
  const r = await c.callTool({ name: 'guard_create_purpose', arguments: LI_OK });
  assert.ok(isError(r));
  assert.match(texto(r), /não permite editar finalidades/);
  assert.equal(chamadas.length, 0);
  await c.close();
});

test('401 da API vira "login expirou"; 403 vira sem permissão; token nunca aparece', async () => {
  const c = await client();
  rotas = () => ({ status: 401, body: { detail: 'jwt expired' } });
  const r401 = await c.callTool({ name: 'guard_list_purposes', arguments: {} });
  assert.ok(isError(r401));
  assert.match(texto(r401), /expirou/);
  assert.doesNotMatch(texto(r401), /jwt-do-usuario/);

  rotas = () => ({ status: 403, body: { type: 'urn:hoc:error:gcc:insufficient-scope' } });
  const r403 = await c.callTool({ name: 'guard_create_purpose', arguments: LI_OK });
  assert.ok(isError(r403));
  assert.match(texto(r403), /papel da sua conta/);
  await c.close();
});

// --- listar / ver ---------------------------------------------------------------

test('guard_list_purposes manda Bearer, filtra por status e devolve link', async () => {
  rotas = (c) =>
    c.url.startsWith('/api/v1/gcc/purposes?')
      ? {
          status: 200,
          body: {
            data: [
              { id: 'p1', name: 'Newsletter', description: 'x', summary: { published_version: 1, published_legal_basis: 'consent', draft_version_id: null } },
              { id: 'p2', name: 'Fraude', description: 'y', summary: { published_version: null, draft_version_id: 'v9', draft_legal_basis: 'legitimate_interest', draft_proposta: { agente: 'Claude', resumo: 'r' } } },
            ],
            meta: { total: 2 },
          },
        }
      : undefined;
  const c = await client();
  const r = JSON.parse(texto(await c.callTool({ name: 'guard_list_purposes', arguments: { status: 'proposta_de_agente', search: 'fr' } })));
  assert.equal(chamadas[0]!.auth, 'Bearer jwt-do-usuario');
  assert.match(chamadas[0]!.url, /search=fr/);
  assert.equal(r.total, 1);
  assert.equal(r.finalidades[0].id, 'p2');
  assert.equal(r.finalidades[0].link, `${base}/privacidade/finalidades/p2`);
  await c.close();
});

test('guard_get_purpose junta publicada e rascunho e aponta pendências', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1') return { status: 200, body: { data: { id: 'p1', name: 'Newsletter', description: 'x' } } };
    if (c.url === '/api/v1/gcc/purposes/p1/versions')
      return {
        status: 200,
        body: {
          data: [
            versao('v1', 'published'),
            versao('v2', 'draft', {
              legal_basis: 'legitimate_interest', retention_days: null,
              config: { purpose_studio: { title: 'N', contexts: [{ law: 'br', basis: 'legitimate_interest', rationale: '', lia: { interest: 'x' } }] } },
            }),
          ],
        },
      };
    return undefined;
  };
  const c = await client();
  const r = JSON.parse(texto(await c.callTool({ name: 'guard_get_purpose', arguments: { id: 'p1' } })));
  assert.equal(r.publicada.status, 'publicada');
  assert.equal(r.publicada.contextos.length, 2);
  assert.equal(r.rascunho.base_legal, 'Legítimo interesse');
  const pend = r.pendencias.join(' | ');
  assert.match(pend, /Retenção não definida/);
  assert.match(pend, /Justificativa/);
  assert.match(pend, /lia_opt_out/);
  assert.match(pend, /Liberar/);
  await c.close();
});

// --- criar ----------------------------------------------------------------------

test('guard_create_purpose cria rascunho com corpo plano e avisa que a pessoa libera', async () => {
  rotas = (c) => (c.method === 'POST' && c.url === '/api/v1/gcc/purposes/assisted' ? { status: 201, body: { data: { id: 'p3', name: 'Prevenção a fraude', draft_version_id: 'v3' } } } : undefined);
  const c = await client();
  const r = await c.callTool({ name: 'guard_create_purpose', arguments: { ...LI_OK, agente: 'Claude Code', resumo: 'checkout coleta CPF' } });
  assert.ok(!isError(r), texto(r));
  const body = chamadas[0]!.body;
  assert.equal(body.title, 'Prevenção a fraude');
  assert.equal(body.lia_opt_out, 'E-mail para dpo@x');
  assert.deepEqual(body.proposta, { agente: 'Claude Code', resumo: 'checkout coleta CPF' });
  assert.equal(body.agente, undefined);
  const out = JSON.parse(texto(r));
  assert.equal(out.link, `${base}/privacidade/finalidades/p3`);
  assert.match(out.aviso, /Liberar na tela do Guard/);
  await c.close();
});

test('guard_create_purpose recusa LI + sensível localmente, sem chamar a API', async () => {
  const c = await client();
  const r = await c.callTool({ name: 'guard_create_purpose', arguments: { ...LI_OK, sensitive: true } });
  assert.ok(isError(r));
  assert.match(texto(r), /consentimento/);
  assert.equal(chamadas.length, 0);
  await c.close();
});

test('422 legitimate-interest-sensitive-data do servidor vira explicação com sugestão', async () => {
  rotas = () => ({ status: 422, body: { type: 'urn:hoc:error:gcc:legitimate-interest-sensitive-data', detail: 'LI com sensível' } });
  const c = await client();
  const r = await c.callTool({ name: 'guard_create_purpose', arguments: LI_OK });
  assert.ok(isError(r));
  assert.match(texto(r), /Use consentimento/);
  await c.close();
});

// --- editar ---------------------------------------------------------------------

test('guard_update_purpose com rascunho: PATCH mescla config sem apagar campos', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1/versions') return { status: 200, body: { data: [versao('v1', 'superseded'), versao('v2', 'draft')] } };
    if (c.method === 'PATCH' && c.url === '/api/v1/gcc/purpose-versions/v2') return { status: 200, body: { data: { id: 'v2' } } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'retenção menor', retention_days: 90, law: 'eu' } });
  assert.ok(!isError(r), texto(r));
  const patch = chamadas.find((x) => x.method === 'PATCH')!;
  assert.equal(patch.body.retention_days, 90);
  assert.equal(patch.body.consent_text, undefined);
  assert.deepEqual(patch.body.config.outro_config, { x: 1 });
  assert.equal(patch.body.config.proposta, undefined);
  const studio = patch.body.config.purpose_studio;
  assert.equal(studio.extra_do_studio, 'manter');
  assert.equal(studio.title, 'Newsletter');
  assert.deepEqual(studio.contexts[0], STUDIO.contexts[0]);
  assert.equal(studio.contexts[1].retention, 90);
  assert.deepEqual(studio.contexts[1].points, ['form-eu']);
  assert.equal(studio.contexts[1].rationale, 'Art. 6(1)(a)');
  assert.equal(patch.body.proposta.resumo, 'retenção menor');
  assert.ok(!chamadas.some((x) => x.url.includes('duplicate')));
  const out = JSON.parse(texto(r));
  assert.equal(out.criado_a_partir_da_publicada, false);
  assert.match(out.aviso, /Liberar/);
  await c.close();
});

test('guard_update_purpose só com publicada: duplica e depois PATCH no rascunho novo', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1/versions') return { status: 200, body: { data: [versao('v1', 'published')] } };
    if (c.method === 'POST' && c.url === '/api/v1/gcc/purpose-versions/v1/duplicate') return { status: 201, body: { data: { id: 'v5', status: 'draft' } } };
    if (c.method === 'PATCH' && c.url === '/api/v1/gcc/purpose-versions/v5') return { status: 200, body: { data: { id: 'v5' } } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'texto mais claro', consent_text: 'Novo texto' } });
  assert.ok(!isError(r), texto(r));
  const ordem = chamadas.map((x) => `${x.method} ${x.url}`);
  assert.deepEqual(ordem.slice(1), ['POST /api/v1/gcc/purpose-versions/v1/duplicate', 'PATCH /api/v1/gcc/purpose-versions/v5']);
  const patch = chamadas.at(-1)!.body;
  assert.equal(patch.consent_text, 'Novo texto');
  assert.equal(patch.config.purpose_studio.text, 'Novo texto');
  assert.equal(patch.config.purpose_studio.contexts.length, 2);
  assert.equal(JSON.parse(texto(r)).criado_a_partir_da_publicada, true);
  await c.close();
});

test('guard_update_purpose recusa virar LI sem teste e exige resumo', async () => {
  rotas = (c) => (c.url === '/api/v1/gcc/purposes/p1/versions' ? { status: 200, body: { data: [versao('v2', 'draft')] } } : undefined);
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'trocar base', legal_basis: 'legitimate_interest' } });
  assert.ok(isError(r));
  assert.match(texto(r), /3 fases/);
  assert.ok(!chamadas.some((x) => x.method === 'PATCH'));

  const semResumo = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', retention_days: 30 } });
  assert.ok(isError(semResumo));
  await c.close();
});

test('409 already-published no PATCH vira mensagem clara', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1/versions') return { status: 200, body: { data: [versao('v2', 'draft')] } };
    if (c.method === 'PATCH') return { status: 409, body: { type: 'urn:hoc:error:gcc:purpose-version-already-published' } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'x', retention_days: 30 } });
  assert.ok(isError(r));
  assert.match(texto(r), /liberado pela pessoa/);
  await c.close();
});

// --- cancelar -------------------------------------------------------------------

test('guard_cancel_purpose_draft apaga só o rascunho', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p2/versions') return { status: 200, body: { data: [versao('v9', 'draft')] } };
    if (c.method === 'DELETE' && c.url === '/api/v1/gcc/purpose-versions/v9') return { status: 200, body: { data: { purpose_removida: true } } };
    return undefined;
  };
  const c = await client();
  const r = JSON.parse(texto(await c.callTool({ name: 'guard_cancel_purpose_draft', arguments: { id: 'p2' } })));
  assert.equal(r.cancelado, true);
  assert.equal(r.finalidade_removida, true);
  await c.close();
});

test('guard_cancel_purpose_draft: proposta do mesmo client mas de outra pessoa (403 not-own-proposal)', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p2/versions') return { status: 200, body: { data: [versao('v9', 'draft')] } };
    if (c.method === 'DELETE') return { status: 403, body: { type: 'urn:hoc:error:gcc:purpose-version-not-own-proposal' } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_cancel_purpose_draft', arguments: { id: 'p2' } });
  assert.ok(isError(r));
  assert.match(texto(r), /não foi proposto por você/);
  assert.match(texto(r), /privacidade\/finalidades\/p2/);
  await c.close();
});

test('guard_cancel_purpose_draft: rascunho da tela nem chega a chamar DELETE', async () => {
  rotas = (c) => (c.url === '/api/v1/gcc/purposes/p2/versions' ? { status: 200, body: { data: [rascunhoDaTela('v9')] } } : undefined);
  const c = await client();
  const r = await c.callTool({ name: 'guard_cancel_purpose_draft', arguments: { id: 'p2' } });
  assert.ok(isError(r));
  assert.match(texto(r), /só cancela a própria proposta/);
  assert.ok(!chamadas.some((x) => x.method === 'DELETE'));
  await c.close();
});

test('guard_cancel_purpose_draft: versão já liberada (409 not-draft) explica', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p2/versions') return { status: 200, body: { data: [versao('v9', 'draft')] } };
    if (c.method === 'DELETE') return { status: 409, body: { type: 'urn:hoc:error:gcc:purpose-version-not-draft' } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_cancel_purpose_draft', arguments: { id: 'p2' } });
  assert.ok(isError(r));
  assert.match(texto(r), /já foi liberada/);
  await c.close();
});

// --- regras de dono ---------------------------------------------------------------

test('guard_update_purpose com rascunho aberto na tela: não edita nem duplica, explica com link', async () => {
  rotas = (c) => (c.url === '/api/v1/gcc/purposes/p1/versions' ? { status: 200, body: { data: [versao('v1', 'published'), rascunhoDaTela('v2')] } } : undefined);
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'x', retention_days: 30 } });
  assert.ok(isError(r));
  assert.match(texto(r), /rascunho aberto por uma pessoa/);
  assert.match(texto(r), /liberar ou descartar/);
  assert.match(texto(r), /privacidade\/finalidades\/p1/);
  assert.ok(!chamadas.some((x) => x.method !== 'GET'));
  await c.close();
});

test('duplicate com 409 purpose-has-other-draft vira a mesma explicação', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1/versions') return { status: 200, body: { data: [versao('v1', 'published')] } };
    if (c.url.endsWith('/duplicate')) return { status: 409, body: { type: 'urn:hoc:error:gcc:purpose-has-other-draft', detail: 'termine ou cancele' } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'x', retention_days: 30 } });
  assert.ok(isError(r));
  assert.match(texto(r), /rascunho aberto por uma pessoa/);
  assert.ok(!chamadas.some((x) => x.method === 'PATCH'));
  await c.close();
});

test('PATCH com 403 purpose-version-not-own-proposal (outra pessoa) vira a mesma explicação', async () => {
  rotas = (c) => {
    if (c.url === '/api/v1/gcc/purposes/p1/versions') return { status: 200, body: { data: [versao('v2', 'draft')] } };
    if (c.method === 'PATCH') return { status: 403, body: { type: 'urn:hoc:error:gcc:purpose-version-not-own-proposal' } };
    return undefined;
  };
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'x', retention_days: 30 } });
  assert.ok(isError(r));
  assert.match(texto(r), /rascunho aberto por uma pessoa/);
  assert.doesNotMatch(texto(r), /papel/);
  await c.close();
});

test('regra violada na edição a partir da publicada não chega a duplicar', async () => {
  rotas = (c) => (c.url === '/api/v1/gcc/purposes/p1/versions' ? { status: 200, body: { data: [versao('v1', 'published')] } } : undefined);
  const c = await client();
  const r = await c.callTool({ name: 'guard_update_purpose', arguments: { id: 'p1', resumo: 'x', legal_basis: 'legitimate_interest' } });
  assert.ok(isError(r));
  assert.match(texto(r), /3 fases/);
  assert.ok(!chamadas.some((x) => x.url.endsWith('/duplicate')));
  await c.close();
});

test('rota fora do alcance do agente (403 agent-route-not-allowed / oauth-client-route-not-allowed)', async () => {
  const c = await client();
  for (const type of ['urn:hoc:error:gcc:agent-route-not-allowed', 'urn:hoc:error:oauth-client-route-not-allowed']) {
    rotas = () => ({ status: 403, body: { type } });
    const r = await c.callTool({ name: 'guard_list_purposes', arguments: {} });
    assert.ok(isError(r));
    assert.match(texto(r), /não libera essa ação para agentes/);
    assert.doesNotMatch(texto(r), /papel/);
  }
  await c.close();
});

test('nenhuma ferramenta de finalidade chama /publish', () => {
  // node:test roda os testes de um arquivo em sequência: este vem por último.
  assert.ok(historico.length > 10);
  assert.ok(!historico.some((x) => /\/publish\b/.test(x.url)), 'alguma ferramenta chamou /publish');
});
