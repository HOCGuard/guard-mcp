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

before(async () => {
  http = createHttpServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');

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

async function client(apiUrl = baseUrl) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl, tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js' });
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
  assert.deepEqual(tools.map(t => t.name).sort(), ['guard_generate_cookie_banner', 'guard_get_scan_results', 'guard_get_scan_status', 'guard_scan_site']);
  await c.close();
});

test('toda ferramenta declara as anotações que o cliente usa para decidir aprovação', async () => {
  const c = await client();
  const { tools } = await c.listTools();
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} sem readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} sem destructiveHint`);
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', `${tool.name} sem openWorldHint`);
  }
  await c.close();
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
