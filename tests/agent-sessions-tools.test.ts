import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { AuditorClient } from '../src/auditor-client.ts';
import { PurposesClient } from '../src/purposes-client.ts';
import { loadCredentials } from '../src/credentials.ts';
import type { Config } from '../src/config.ts';

// Servidor único imitando ao mesmo tempo o auth_server (device flow, refresh,
// revoke) e a API de recursos (gcc / auditor): cada teste define `rotas`, e
// toda chamada fica registrada em `chamadas` pro teste conferir corpo e Bearer.
type Chamada = { method: string; url: string; body: URLSearchParams | Record<string, unknown> | undefined; auth: string | undefined };
type Rota = (c: Chamada) => { status: number; body?: unknown } | undefined;

let http: Server;
let base: string;
let chamadas: Chamada[] = [];
let rotas: Rota = () => undefined;
let dir: string;
let credPath: string;

function parseBody(url: string, raw: string): Chamada['body'] {
  if (!raw) return undefined;
  if (url.startsWith('/oauth/')) return new URLSearchParams(raw);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

before(async () => {
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const chamada: Chamada = {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        body: parseBody(req.url ?? '', raw),
        auth: req.headers['authorization'] as string | undefined,
      };
      chamadas.push(chamada);
      const r = rotas(chamada) ?? { status: 404, body: { detail: 'rota não mockada' } };
      res.setHeader('content-type', 'application/json');
      res.writeHead(r.status);
      res.end(r.body === undefined ? '' : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => http.close());

beforeEach(async () => {
  chamadas = [];
  rotas = () => undefined;
  dir = await mkdtemp(join(tmpdir(), 'hocguard-sessions-'));
  credPath = join(dir, 'credentials.json');
});

function texto(result: unknown) {
  return (result as { content: { text: string }[] }).content[0]!.text;
}
function isError(result: unknown) {
  return (result as { isError?: boolean }).isError === true;
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    apiUrl: base,
    tenant: 'public',
    requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js',
    serviceToken: undefined,
    authUrl: base,
    credentialsPath: credPath,
    ...overrides,
  };
}

// --- guard_login manda agent_name / agent_client --------------------------------

test('guard_login manda agent_name e agent_client mapeados do clientInfo do handshake', async () => {
  rotas = (c) => {
    if (c.url === '/oauth/device/code') {
      return {
        status: 200,
        body: {
          device_code: 'dc-1', user_code: 'ABCD-1234',
          verification_uri: `${base}/auth/device`, verification_uri_complete: `${base}/auth/device?code=ABCD-1234`,
          expires_in: 900, interval: 1,
        },
      };
    }
    return undefined;
  };

  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'Visual Studio Code', version: '1.2.3' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  await c.callTool({ name: 'guard_login', arguments: {} });

  const req = chamadas.find((x) => x.url === '/oauth/device/code');
  assert.ok(req, 'esperava POST /oauth/device/code');
  const body = req!.body as URLSearchParams;
  assert.equal(body.get('agent_client'), 'github-copilot');
  assert.match(body.get('agent_name') ?? '', /^GitHub Copilot · /);

  await c.close();
});

test('guard_login usa agent_client "outro" pra clientInfo desconhecido', async () => {
  rotas = (c) =>
    c.url === '/oauth/device/code'
      ? { status: 200, body: { device_code: 'dc', user_code: 'X', verification_uri: base, verification_uri_complete: base, expires_in: 900, interval: 1 } }
      : undefined;

  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'MeuClienteObscuro', version: '1.0.0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);
  await c.callTool({ name: 'guard_login', arguments: {} });

  const req = chamadas.find((x) => x.url === '/oauth/device/code')!;
  assert.equal((req.body as URLSearchParams).get('agent_client'), 'outro');
  await c.close();
});

// --- guard_login_check salva refresh_token ---------------------------------------

function fakeJwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64({ sub })}.sig`;
}

test('guard_login_check salva o refresh_token quando o servidor manda', async () => {
  rotas = (c) => {
    if (c.url === '/oauth/device/code') {
      return { status: 200, body: { device_code: 'dc', user_code: 'X', verification_uri: base, verification_uri_complete: base, expires_in: 900, interval: 1 } };
    }
    if (c.url === '/oauth/device/token') {
      return { status: 200, body: { access_token: fakeJwt('user-1'), token_type: 'Bearer', expires_in: 3600, scope: 'scan', refresh_token: 'rt-inicial' } };
    }
    return undefined;
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'Claude Code', version: '1.0.0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  await c.callTool({ name: 'guard_login', arguments: {} });
  await c.callTool({ name: 'guard_login_check', arguments: {} });

  const cred = await loadCredentials(credPath);
  assert.equal(cred?.refresh_token, 'rt-inicial');
  await c.close();
});

test('guard_login_check funciona sem refresh_token (compat com backend antigo)', async () => {
  rotas = (c) => {
    if (c.url === '/oauth/device/code') {
      return { status: 200, body: { device_code: 'dc', user_code: 'X', verification_uri: base, verification_uri_complete: base, expires_in: 900, interval: 1 } };
    }
    if (c.url === '/oauth/device/token') {
      return { status: 200, body: { access_token: fakeJwt('user-1'), token_type: 'Bearer', expires_in: 3600, scope: 'scan' } };
    }
    return undefined;
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'Claude Code', version: '1.0.0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  await c.callTool({ name: 'guard_login', arguments: {} });
  const check = await c.callTool({ name: 'guard_login_check', arguments: {} });
  assert.match(texto(check), /Conectado/);

  const cred = await loadCredentials(credPath);
  assert.equal(cred?.access_token, fakeJwt('user-1'));
  assert.equal(cred?.refresh_token, undefined);
  await c.close();
});

// --- guard_logout revoga o refresh_token -----------------------------------------

test('guard_logout chama POST /oauth/revoke com token e client_id, e apaga a credencial', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'a', expires_at: Date.now() + 60_000, scope: 'scan', refresh_token: 'rt-para-revogar' }));
  rotas = (c) => (c.url === '/oauth/revoke' ? { status: 200, body: {} } : undefined);

  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  await c.callTool({ name: 'guard_logout', arguments: {} });

  const req = chamadas.find((x) => x.url === '/oauth/revoke');
  assert.ok(req, 'esperava POST /oauth/revoke');
  const body = req!.body as URLSearchParams;
  assert.equal(body.get('token'), 'rt-para-revogar');
  assert.equal(body.get('client_id'), 'guard-mcp');
  assert.equal(await loadCredentials(credPath), null);
  await c.close();
});

test('guard_logout ignora falha na revogação (rota ausente ou fora do ar) e apaga a credencial local', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'a', expires_at: Date.now() + 60_000, scope: 'scan', refresh_token: 'rt-1' }));
  rotas = () => ({ status: 500, body: { detail: 'boom' } });

  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  const logout = await c.callTool({ name: 'guard_logout', arguments: {} });
  assert.ok(!isError(logout));
  assert.match(texto(logout), /encerrada/i);
  assert.equal(await loadCredentials(credPath), null);
  await c.close();
});

test('guard_logout sem refresh_token não chama /oauth/revoke', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'a', expires_at: Date.now() + 60_000, scope: 'scan' }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0' });
  const server = createServer(config());
  await Promise.all([server.connect(b), c.connect(a)]);

  await c.callTool({ name: 'guard_logout', arguments: {} });
  assert.equal(chamadas.find((x) => x.url === '/oauth/revoke'), undefined);
  await c.close();
});

// --- retry único em 401 -----------------------------------------------------------

test('PurposesClient: 401 na API renova o token uma vez e repete a chamada com sucesso', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'expirado-no-servidor', expires_at: Date.now() + 60_000, scope: 'gcc:purposes:read', refresh_token: 'rt-1' }));

  let purposesCalls = 0;
  rotas = (c) => {
    if (c.url === '/oauth/token') {
      return { status: 200, body: { access_token: 'renovado', token_type: 'Bearer', expires_in: 3600, scope: 'gcc:purposes:read', refresh_token: 'rt-2' } };
    }
    if (c.url.startsWith('/api/v1/gcc/purposes')) {
      purposesCalls++;
      if (c.auth === 'Bearer expirado-no-servidor') return { status: 401, body: { detail: 'jwt expired' } };
      if (c.auth === 'Bearer renovado') return { status: 200, body: { data: [] } };
      return { status: 401, body: {} };
    }
    return undefined;
  };

  const client = new PurposesClient(config());
  const out = await client.list({ page: 1, per_page: 10 });
  assert.deepEqual(out.data, []);
  assert.equal(purposesCalls, 2, 'esperava a chamada original (401) + o retry (200)');

  const cred = await loadCredentials(credPath);
  assert.equal(cred?.access_token, 'renovado');
});

test('PurposesClient: sem refresh_token, 401 não tenta de novo e explica que o login expirou', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'expirado', expires_at: Date.now() + 60_000, scope: 'gcc:purposes:read' }));
  let purposesCalls = 0;
  rotas = (c) => {
    if (c.url.startsWith('/api/v1/gcc/purposes')) {
      purposesCalls++;
      return { status: 401, body: { detail: 'jwt expired' } };
    }
    return undefined;
  };
  const client = new PurposesClient(config());
  await assert.rejects(client.list({ page: 1, per_page: 10 }), (e: unknown) => e instanceof Error && /expirou/.test(e.message));
  assert.equal(purposesCalls, 1, 'sem refresh_token não há retry');
});

test('AuditorClient: 401 na API renova o token uma vez e repete a chamada com sucesso', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'expirado-no-servidor', expires_at: Date.now() + 60_000, scope: 'scan', refresh_token: 'rt-1' }));

  let auditCalls = 0;
  rotas = (c) => {
    if (c.url === '/oauth/token') {
      return { status: 200, body: { access_token: 'renovado', token_type: 'Bearer', expires_in: 3600, scope: 'scan', refresh_token: 'rt-2' } };
    }
    if (c.url === '/audit') {
      auditCalls++;
      if (c.auth === 'Bearer expirado-no-servidor') return { status: 401, body: { detail: 'jwt expired' } };
      if (c.auth === 'Bearer renovado') return { status: 202, body: { job_id: 'j1' } };
      return { status: 401, body: {} };
    }
    return undefined;
  };

  const client = new AuditorClient(config());
  const out = await client.startScan('https://exemplo.com.br', 'lgpd');
  assert.equal(out.job_id, 'j1');
  assert.equal(auditCalls, 2);
});

// --- invalid_grant na renovação: limpa credenciais e orienta login de novo --------

test('PurposesClient: invalid_grant na renovação limpa a credencial e a mensagem pede guard_login', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'expirado', expires_at: Date.now() - 1000, scope: 'gcc:purposes:read', refresh_token: 'rt-morto' }));
  rotas = (c) => (c.url === '/oauth/token' ? { status: 400, body: { error: 'invalid_grant' } } : undefined);

  const client = new PurposesClient(config());
  await assert.rejects(client.list({ page: 1, per_page: 10 }), (e: unknown) => {
    assert.ok(e instanceof Error);
    assert.match(e.message, /guard_login/);
    return true;
  });
  assert.equal(await loadCredentials(credPath), null);
});
