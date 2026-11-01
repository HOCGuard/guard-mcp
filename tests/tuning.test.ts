// Hguard-2583: instructions do servidor, saída estruturada da varredura e
// aviso de login quando não há para onde mandar a varredura.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { DEFAULT_API_URL } from '../src/config.ts';

let credDir: string;
let http: Server;
let baseUrl: string;
let chamadas = 0;

before(async () => {
  credDir = await mkdtemp(join(tmpdir(), 'hocguard-tuning-'));
  http = createHttpServer((req, res) => {
    chamadas++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/audit/r1/report') {
      res.writeHead(200);
      res.end(JSON.stringify({ url: 'https://x.com.br', score: { overall: 70, grade: 'C', summary: { coverage_ratio: 0.9 } }, checks: [{ id: 'a', label: 'A', status: 'fail', severity: 'high' }] }));
      return;
    }
    if (req.url === '/audit/r1/status') {
      res.writeHead(200);
      res.end(JSON.stringify({ job_id: 'r1', status: 'completed', elapsed_ms: 90000 }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const a = http.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(async () => {
  http.close();
  await rm(credDir, { recursive: true, force: true });
});

async function client(apiUrl: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl, tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined, credentialsPath: join(credDir, 'credentials.json') });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

test('servidor manda instructions com o roteiro das ferramentas', async () => {
  const c = await client(baseUrl);
  const instructions = c.getInstructions() ?? '';
  for (const tool of ['guard_scan_site', 'guard_get_scan_results', 'guard_login', 'guard_explain']) assert.match(instructions, new RegExp(tool));
  assert.match(instructions, /verdict/);
  await c.close();
});

test('status e resultado da varredura declaram outputSchema e devolvem structuredContent', async () => {
  const c = await client(baseUrl);
  const { tools } = await c.listTools();
  for (const name of ['guard_get_scan_status', 'guard_get_scan_results']) {
    assert.ok(tools.find((t) => t.name === name)?.outputSchema, `${name} sem outputSchema`);
  }
  const status = await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: 'r1' } }) as { structuredContent?: Record<string, unknown> };
  assert.equal(status.structuredContent?.['ready'], true);
  const r = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'r1' } }) as { structuredContent?: Record<string, unknown>; content: { text: string }[] };
  assert.equal(r.structuredContent?.['verdict'], 'confirmado');
  assert.deepEqual(JSON.parse(r.content[0]!.text), r.structuredContent);
  await c.close();
});

test('sem login, sem token de serviço e com GUARD_API_URL padrão: pede login e não chama nada', async () => {
  const c = await client(DEFAULT_API_URL);
  const antes = chamadas;
  const r = await c.callTool({ name: 'guard_scan_site', arguments: { url: 'https://exemplo.com.br' } }) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /guard_login/);
  assert.doesNotMatch(r.content[0]!.text, /fetch failed|localhost/);
  assert.equal(chamadas, antes);
  await c.close();
});
