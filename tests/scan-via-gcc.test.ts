// Hguard-2582: com login que tem gcc:audit:*, a varredura passa pelo gcc,
// entra em Sites e o resultado vem do relatório do Guard. Sem esses scopes,
// ou com servidor anterior, segue o caminho de antes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { summarizeGccReport, failureCodeFromText } from '../src/gcc-report.ts';

let http: Server;
let base: string;
let dir: string;
let chamadas: Array<{ method: string; url: string; body: string }> = [];
let rotaGccFechada = false;
let posseFaltando = false;
let relatorio: Record<string, unknown> = {};
let semId = false;
let semScope = false;

const REL_OK = {
  analise: { id: 'a1', url: 'https://exemplo.com.br', status: 'completed', nota: 'C', score: 61, motivo_nao_visto: null },
  nota: 'C', score: 61, nota_parcial: false, completude: 'completa',
  fatores: [{ id: 'consentimento', nota: 'D', problemas: 2 }, { id: 'transparencia', nota: 'B', problemas: 0 }],
  achados: [
    { id: 'pre-consent', grupo: 'corrigir', titulo: 'Rastreador dispara antes do aceite', acao: 'Bloquear até o aceite', porque: 'A LGPD exige consentimento antes.', certeza: 'confirmado' },
    { id: 'rodape', grupo: 'melhorar', titulo: 'Link de preferências no rodapé', acao: 'Pôr o link', certeza: 'confirmado' },
  ],
  a_confirmar: [{ id: 'recusa', grupo: 'corrigir', titulo: 'Recusar pode não limpar cookies', certeza: 'a_confirmar' }],
  incertos: [{ id: 'lgpd_dpo_accessible', pergunta: 'A política mostra o encarregado?', motivo: 'Leitura não confirmou' }],
  nao_medidos: [{ id: 'recusa', titulo: 'Não achamos o botão de recusar', motivo: 'Botão não encontrado' }],
  acertos: ['Banner aparece na primeira visita'],
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hocguard-gcc-'));
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      chamadas.push({ method: req.method ?? '', url: req.url ?? '', body: raw });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/v1/gcc/audits') {
        if (rotaGccFechada) {
          res.writeHead(403);
          res.end(JSON.stringify({ type: 'urn:hoc:error:agent:blocked', status: 403, detail: 'Rota fora do alcance.', motivo: 'rota-nao-permitida' }));
          return;
        }
        if (semScope) {
          res.writeHead(403);
          res.end(JSON.stringify({ type: 'urn:hoc:error:gcc:insufficient-scope', status: 403, detail: 'Esta rota exige um dos scopes: gcc:audit:write.' }));
          return;
        }
        if (semId) {
          res.writeHead(202);
          res.end(JSON.stringify({ job_id: 'j9', status: 'queued' }));
          return;
        }
        if (posseFaltando) {
          res.writeHead(403);
          res.end(JSON.stringify({ type: 'urn:hoc:error:gcc:ownership-not-verified', status: 403, detail: 'É necessário verificar a posse do domínio.' }));
          return;
        }
        res.writeHead(202);
        res.end(JSON.stringify({ job_id: 'j1', audit_report_id: 'a1', status: 'queued' }));
        return;
      }
      if (req.url === '/api/v1/gcc/audits/a1/relatorio') {
        res.writeHead(200);
        res.end(JSON.stringify(relatorio));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/v1/consent/audit') {
        res.writeHead(202);
        res.end(JSON.stringify({ job_id: 'legado-1', status: 'queued' }));
        return;
      }
      if (req.url === '/oauth/device/code') {
        const scope = new URLSearchParams(raw).get('scope') ?? '';
        if (scope.includes('gcc:audit')) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_scope', error_description: 'scope fora da allowlist' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ device_code: 'dc', user_code: 'AAAA-BBBB', verification_uri: `${base}/auth/device`, verification_uri_complete: `${base}/auth/device?code=AAAA-BBBB`, expires_in: 900, interval: 1 }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const a = http.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(async () => {
  http.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  chamadas = [];
  rotaGccFechada = false;
  posseFaltando = false;
  semId = false;
  semScope = false;
  relatorio = structuredClone(REL_OK);
});

async function client(scope: string | null) {
  const credentialsPath = join(dir, `cred-${Math.random()}.json`);
  if (scope !== null) await writeFile(credentialsPath, JSON.stringify({ access_token: 'jwt', expires_at: Date.now() + 3_600_000, scope }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://127.0.0.1:1', tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined, authUrl: base, credentialsPath, homeDir: dir });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

const COM_GCC = 'scan generate gcc:audit:read gcc:audit:write';
function json(r: unknown) {
  return JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
}
function texto(r: unknown) {
  return (r as { content: { text: string }[] }).content[0]!.text;
}

test('login com gcc:audit:* varre pelo gcc só com url e framework, e devolve o link de Sites', async () => {
  const c = await client(COM_GCC);
  const r = json(await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }));
  assert.equal(r.scan_id, 'gcc:a1');
  assert.equal(r.link, `${base}/privacidade/scans/a1`);
  const post = chamadas.find((x) => x.url === '/api/v1/gcc/audits')!;
  assert.deepEqual(JSON.parse(post.body), { url: 'https://exemplo.com.br', framework: 'lgpd' });
  assert.ok(!chamadas.some((x) => x.url.startsWith('/api/v1/consent')));
  await c.close();
});

test('resultado pelo gcc: veredito, pilares, achados, perguntas e link', async () => {
  const c = await client(COM_GCC);
  const r = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'gcc:a1' } }) as { structuredContent: any };
  const s = r.structuredContent;
  assert.equal(s.verdict, 'preliminar');
  assert.match(s.verdict_note, /Não achamos o botão de recusar/);
  assert.equal(s.grade, 'C');
  assert.equal(s.score, undefined);
  assert.equal(s.link, `${base}/privacidade/scans/a1`);
  assert.deepEqual(s.pillars, [{ id: 'consentimento', grade: 'D', problems: 2 }, { id: 'transparencia', grade: 'B', problems: 0 }]);
  assert.deepEqual(s.counts, { corrigir: 1, melhorar: 1, a_confirmar: 1, perguntas: 1, acertos: 1 });
  assert.deepEqual(s.findings.map((f: any) => [f.id, f.kind, f.priority ?? null, f.uncertain ?? false]), [
    ['pre-consent', 'achado', 'corrigir', false],
    ['rodape', 'achado', 'melhorar', false],
    ['recusa', 'achado', 'corrigir', true],
    ['lgpd_dpo_accessible', 'pergunta', null, true],
  ]);
  await c.close();
});

test('status pelo gcc: rodando traz o link; falha traz só o código, sem o texto de erro', async () => {
  const c = await client(COM_GCC);
  relatorio = { analise: { id: 'a1', status: 'running' } };
  const rodando = json(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: 'gcc:a1' } }));
  assert.equal(rodando.status, 'running');
  assert.equal(rodando.link, `${base}/privacidade/scans/a1`);
  relatorio = { analise: { id: 'a1', status: 'failed', erro: 'O robots.txt de exemplo.com.br proibe o auditor (Disallow: /). at /app/dist/x.js:10' } };
  const falhou = json(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: 'gcc:a1' } }));
  assert.equal(falhou.reason, 'blocked_by_robots_txt');
  assert.doesNotMatch(JSON.stringify(falhou), /app\/dist/);
  const res = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'gcc:a1' } });
  assert.match(texto(res), /falhou/);
  await c.close();
});

test('servidor sem a rota de agente no gcc: volta para a varredura de antes', async () => {
  rotaGccFechada = true;
  const c = await client(COM_GCC);
  const r = json(await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }));
  assert.equal(r.scan_id, 'legado-1');
  assert.equal(r.link, undefined);
  await c.close();
});

test('login sem gcc:audit:* segue a varredura de antes', async () => {
  const c = await client('scan generate');
  const r = json(await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }));
  assert.equal(r.scan_id, 'legado-1');
  assert.ok(!chamadas.some((x) => x.url === '/api/v1/gcc/audits'));
  await c.close();
});

test('domínio sem posse verificada vira orientação, não "login expirou"', async () => {
  posseFaltando = true;
  const c = await client(COM_GCC);
  const r = await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } });
  assert.match(texto(r), /verificar a posse do domínio/);
  assert.doesNotMatch(texto(r), /login/);
  await c.close();
});

test('guard_login: servidor que recusa gcc:audit:* recebe o pedido de antes', async () => {
  const c = await client(null);
  const r = await c.callTool({ name: 'guard_login', arguments: {} });
  assert.match(texto(r), /AAAA-BBBB/);
  const pedidos = chamadas.filter((x) => x.url === '/oauth/device/code').map((x) => new URLSearchParams(x.body).get('scope'));
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[0]!, /gcc:audit:write/);
  assert.doesNotMatch(pedidos[1]!, /gcc:audit/);
  await c.close();
});

test('página não vista: sem nota nem nota de pilar', () => {
  const s = summarizeGccReport({ analise: { status: 'completed', motivo_nao_visto: 'blocked' }, nota: null, fatores: [{ id: 'consentimento', nota: 'F', problemas: 0 }] }, 'https://g/x');
  assert.equal(s.verdict, 'nao_vimos_o_site');
  assert.equal(s.grade, undefined);
  assert.deepEqual(s.pillars, [{ id: 'consentimento', problems: 0 }]);
});

test('relatório completo e sem pendência sai confirmado com score', () => {
  const s = summarizeGccReport({ analise: { status: 'completed' }, nota: 'A', score: 95, completude: 'completa', achados: [], a_confirmar: [], incertos: [], nao_medidos: [] }, 'https://g/x');
  assert.equal(s.verdict, 'confirmado');
  assert.equal(s.score, 95);
});

test('código de falha a partir do texto do gcc', () => {
  assert.equal(failureCodeFromText('O robots.txt de x proibe o auditor (Disallow: /).'), 'blocked_by_robots_txt');
  assert.equal(failureCodeFromText('timeout: audit deadline exceeded'), 'timeout');
  assert.equal(failureCodeFromText('net::ERR_NAME_NOT_RESOLVED'), 'site_unreachable');
  assert.equal(failureCodeFromText(null), 'internal_error');
});

test('revisão: 2xx sem id não cai no caminho antigo (não pede duas vezes)', async () => {
  semId = true;
  const c = await client(COM_GCC);
  const r = await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }) as { isError?: boolean };
  assert.equal(r.isError, true);
  assert.ok(!chamadas.some((x) => x.url === '/api/v1/consent/audit'));
  await c.close();
});

test('revisão: papel sem gcc:audit:write com token vivo volta ao caminho antigo', async () => {
  semScope = true;
  const c = await client(COM_GCC);
  const r = json(await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }));
  assert.equal(r.scan_id, 'legado-1');
  await c.close();
});

test('revisão: scan_id gcc com caminho é recusado sem chamar o Guard', async () => {
  const c = await client(COM_GCC);
  for (const id of ['gcc:..', 'gcc:a1/../x', 'gcc:']) {
    const r = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: id } }) as { isError?: boolean };
    assert.equal(r.isError, true, id);
  }
  assert.ok(!chamadas.some((x) => x.url.includes('/relatorio') && !x.url.includes('/a1/')));
  await c.close();
});

test('revisão: falha usa o erro_codigo do gcc e lê o relatório uma vez', async () => {
  relatorio = { analise: { id: 'a1', status: 'failed', erro: null, erro_codigo: 'captcha_blocked' } };
  const c = await client(COM_GCC);
  const r = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'gcc:a1' } });
  assert.match(texto(r), /anti-robô/);
  assert.equal(chamadas.filter((x) => x.url === '/api/v1/gcc/audits/a1/relatorio').length, 1);
  await c.close();
});
