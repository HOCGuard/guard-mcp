// Hguard-2578: varredura que falhou sai com motivo e próximo passo, nunca
// como "ainda não terminou" (o agente ficava em loop).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { explainFailure, failureMessage } from '../src/scan-failure.ts';

let http: Server;
let baseUrl: string;
let credDir: string;

before(async () => {
  credDir = await mkdtemp(join(tmpdir(), 'hocguard-falha-'));
  http = createHttpServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = req.url ?? '';
    if (url === '/audit/robots/status') {
      res.writeHead(200);
      res.end(JSON.stringify({ job_id: 'robots', status: 'failed', elapsed_ms: 14000, failure: { code: 'blocked_by_robots_txt', detail: 'O robots.txt de seuimposto.com proibe o auditor (Disallow: /).' } }));
      return;
    }
    if (url === '/audit/antigo/status') {
      // Auditor anterior à 2578: failed sem failure.
      res.writeHead(200);
      res.end(JSON.stringify({ job_id: 'antigo', status: 'failed', elapsed_ms: 3000 }));
      return;
    }
    if (url === '/audit/robots/report' || url === '/audit/antigo/report') {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Relatório ainda não disponível', status: 'failed' }));
      return;
    }
    if (url === '/audit/rodando/report') {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Relatório ainda não disponível', status: 'active' }));
      return;
    }
    if (url === '/audit/rodando/status') {
      res.writeHead(200);
      res.end(JSON.stringify({ job_id: 'rodando', status: 'running', elapsed_ms: 5000 }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Job não encontrado' }));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  http.close();
  await rm(credDir, { recursive: true, force: true });
});

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({
    apiUrl: baseUrl, tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined,
    credentialsPath: join(credDir, 'credentials.json'),
  });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

function texto(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

test('status failed traz motivo, próximo passo e diz que repetir não adianta', async () => {
  const c = await client();
  const r = JSON.parse(texto(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: 'robots' } })));
  assert.equal(r.status, 'failed');
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'blocked_by_robots_txt');
  assert.match(r.motivo, /robots\.txt/);
  assert.match(r.motivo, /seuimposto\.com/);
  assert.match(r.next, /HOC-ConsentAuditor/);
  assert.equal(r.retry_helps, false);
  await c.close();
});

test('resultado de varredura que falhou diz que falhou, não que ainda não terminou', async () => {
  const c = await client();
  const result = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'robots' } });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(texto(result), /^A varredura robots falhou\./);
  assert.doesNotMatch(texto(result), /ainda não terminou/);
  await c.close();
});

test('auditor antigo sem failure: falha genérica, com caminho para reportar', async () => {
  const c = await client();
  const r = JSON.parse(texto(await c.callTool({ name: 'guard_get_scan_status', arguments: { scan_id: 'antigo' } })));
  assert.equal(r.reason, 'internal_error');
  assert.match(r.next, /github\.com\/HOCGuard\/guard-mcp\/issues/);
  const result = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'antigo' } });
  assert.match(texto(result), /falhou/);
  await c.close();
});

test('409 de varredura rodando continua mandando esperar', async () => {
  const c = await client();
  const result = await c.callTool({ name: 'guard_get_scan_results', arguments: { scan_id: 'rodando' } });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(texto(result), /ainda não terminou/);
  await c.close();
});

test('todo código conhecido tem motivo e próximo passo próprios', () => {
  for (const code of ['blocked_by_robots_txt', 'robots_unreachable', 'site_unreachable', 'timeout', 'captcha_blocked', 'redirected_off_site', 'cancelled']) {
    const e = explainFailure({ code });
    assert.equal(e.reason, code);
    assert.doesNotMatch(e.motivo, /problema do nosso lado/, code);
  }
  assert.match(failureMessage('x', undefined), /problema do nosso lado/);
});
