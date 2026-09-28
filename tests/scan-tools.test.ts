import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';

// Imita o contrato real do hoc-consent-auditor: POST /audit devolve 202 com
// job_id, o status é consultado por poll e o relatório só sai com 409 antes de
// terminar.
let http: Server;
let baseUrl: string;
let pollsAntesDeTerminar = 2;
let ultimoServiceToken: string | null | undefined;

before(async () => {
  http = createHttpServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');
    ultimoServiceToken = req.headers['x-service-token'] as string | undefined;

    if (req.method === 'POST' && url === '/audit') {
      res.writeHead(202);
      res.end(JSON.stringify({ job_id: '01JQ', status: 'queued', estimated_duration_seconds: 120, poll_url: '/audit/01JQ/status' }));
      return;
    }
    if (url === '/audit/01JQ/status') {
      const pronto = pollsAntesDeTerminar-- <= 0;
      res.writeHead(200);
      res.end(JSON.stringify({ job_id: '01JQ', status: pronto ? 'completed' : 'running', elapsed_ms: 8000 }));
      return;
    }
    if (url === '/audit/01JQ/report') {
      if (pollsAntesDeTerminar > 0) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'Relatório ainda não disponível', status: 'active' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        report_id: 'rep_1',
        url: 'https://exemplo.com.br',
        score: { overall: 42, grade: 'D' },
        checks: [{ id: 'no_pre_consent_firing', label: 'Sem disparo antes do consentimento', status: 'fail', severity: 'critical', result_detail: '3 rastreadores' }],
        dark_patterns: [],
      }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Job não encontrado' }));
  });

  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(() => http.close());

async function client(apiUrl = baseUrl, serviceToken: string | undefined = undefined) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl, tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

function payload(result: unknown) {
  const first = (result as { content: { text: string }[] }).content[0];
  return JSON.parse(first!.text) as Record<string, unknown>;
}

test('expõe exatamente as ferramentas de varredura e de geração', async () => {
  const c = await client();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['guard_add_consent_point', 'guard_cancel_purpose_draft', 'guard_check_compliance', 'guard_create_banner', 'guard_create_purpose', 'guard_explain', 'guard_generate_cookie_banner', 'guard_generate_policy', 'guard_get_purpose', 'guard_get_scan_results', 'guard_get_scan_status', 'guard_list_purposes', 'guard_login', 'guard_login_check', 'guard_logout', 'guard_make_compliant', 'guard_scan_site', 'guard_update_purpose']);
  await c.close();
});

test('toda ferramenta declara as anotações que o cliente usa para decidir aprovação', async () => {
  const c = await client();
  const { tools } = await c.listTools();
  // Quem escreve algo (servidor ou disco) tem que dizer, para o cliente pedir aprovação.
  // guard_login* e guard_logout gravam/apagam estado local em ~/.hocguard.
  // As de finalidade gravam rascunho na conta; só o cancelamento apaga.
  const escrevem = new Set(['guard_create_banner', 'guard_login', 'guard_login_check', 'guard_logout', 'guard_create_purpose', 'guard_update_purpose', 'guard_cancel_purpose_draft']);
  const apagam = new Set(['guard_cancel_purpose_draft']);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, !escrevem.has(tool.name), `${tool.name} com readOnlyHint errado`);
    assert.equal(tool.annotations?.destructiveHint, apagam.has(tool.name), `${tool.name} com destructiveHint errado`);
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', `${tool.name} sem openWorldHint`);
  }
  await c.close();
});

test('Hguard-1434: manda X-Service-Token quando configurado, e nada quando não', async () => {
  const comToken = await client(baseUrl, 'segredo-123');
  await comToken.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } });
  assert.equal(ultimoServiceToken, 'segredo-123');

  const semToken = await client(baseUrl, undefined);
  await semToken.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } });
  assert.equal(ultimoServiceToken, undefined);
});

test('o ciclo completo devolve achado ordenado e compacto', async () => {
  const c = await client();

  const started = payload(await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }));
  assert.equal(started['scan_id'], '01JQ');

  const running = payload(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: '01JQ' } }));
  assert.equal(running['ready'], false);

  const cedoDemais = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: '01JQ' } });
  assert.equal((cedoDemais as { isError?: boolean }).isError, true);

  await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: '01JQ' } });
  const pronto = payload(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: '01JQ' } }));
  assert.equal(pronto['ready'], true);

  const results = payload(await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: '01JQ' } }));
  assert.equal(results['grade'], 'D');
  assert.equal((results['findings'] as unknown[]).length, 1);

  await c.close();
});

test('serviço fora do ar vira erro legível, não exceção', async () => {
  const c = await client('http://127.0.0.1:1');
  const result = await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } });
  assert.equal((result as { isError?: boolean }).isError, true);
  const texto = (result as { content: { text: string }[] }).content[0]!.text;
  assert.match(texto, /não foi possível falar com o serviço de varredura/i);
  await c.close();
});
