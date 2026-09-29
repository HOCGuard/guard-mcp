import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { AuditorClient } from '../src/auditor-client.ts';
import {
  requestDeviceCode,
  pollOnce,
  decodeJwtSubject,
  DeviceFlowError,
} from '../src/auth/device-flow.ts';
import {
  resolveCredentialsPath,
  resolvePendingPath,
  saveCredentials,
  loadCredentials,
  activeToken,
  deleteCredentials,
} from '../src/credentials.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// JWT falso (sem assinatura valida): so o payload importa pra decodeJwtSubject.
function fakeJwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64({ sub })}.sig`;
}

// --- device-flow client ------------------------------------------------------

test('requestDeviceCode devolve os campos da RFC 8628', async () => {
  const fetchImpl = (async () =>
    jsonResponse(200, {
      device_code: 'dc', user_code: 'WXYZ-1234',
      verification_uri: 'https://auth.x/auth/device',
      verification_uri_complete: 'https://auth.x/auth/device?code=WXYZ-1234',
      expires_in: 900, interval: 5,
    })) as unknown as typeof fetch;
  const out = await requestDeviceCode('https://auth.x', { clientId: 'guard-mcp', scope: 'scan' }, { fetchImpl });
  assert.equal(out.user_code, 'WXYZ-1234');
  assert.equal(out.interval, 5);
});

test('requestDeviceCode erra legivel quando o auth recusa', async () => {
  const fetchImpl = (async () => jsonResponse(400, { error: 'invalid_scope', error_description: 'scope xpto' })) as unknown as typeof fetch;
  await assert.rejects(
    requestDeviceCode('https://auth.x', { clientId: 'guard-mcp', scope: 'xpto' }, { fetchImpl }),
    (e: unknown) => e instanceof DeviceFlowError && /scope xpto/.test((e as Error).message),
  );
});

test('pollOnce mapeia cada estado da RFC 8628', async () => {
  const token = await pollOnce('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc' }, {
    fetchImpl: (async () => jsonResponse(200, { access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, scope: 'scan' })) as unknown as typeof fetch,
  });
  assert.equal(token.kind, 'token');
  if (token.kind === 'token') assert.equal(token.token.access_token, 'jwt');

  const pend = await pollOnce('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc' }, {
    fetchImpl: (async () => jsonResponse(400, { error: 'authorization_pending' })) as unknown as typeof fetch,
  });
  assert.equal(pend.kind, 'pending');

  const slow = await pollOnce('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc' }, {
    fetchImpl: (async () => jsonResponse(400, { error: 'slow_down' })) as unknown as typeof fetch,
  });
  assert.equal(slow.kind, 'slow_down');

  const exp = await pollOnce('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc' }, {
    fetchImpl: (async () => jsonResponse(400, { error: 'expired_token' })) as unknown as typeof fetch,
  });
  assert.equal(exp.kind, 'expired');

  const den = await pollOnce('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc' }, {
    fetchImpl: (async () => jsonResponse(400, { error: 'access_denied' })) as unknown as typeof fetch,
  });
  assert.equal(den.kind, 'denied');
});

test('decodeJwtSubject extrai o sub', () => {
  assert.equal(decodeJwtSubject(fakeJwt('user-123')), 'user-123');
  assert.equal(decodeJwtSubject('nao-e-jwt'), null);
});

// --- credenciais -------------------------------------------------------------

test('credenciais: salva, le, expira e apaga sem tocar em ~', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-cred-'));
  const path = join(dir, 'credentials.json');
  await saveCredentials(path, { access_token: 'tok', expires_at: Date.now() + 60_000, scope: 'scan' });
  const cred = await loadCredentials(path);
  assert.equal(cred?.access_token, 'tok');
  assert.equal(activeToken(cred), 'tok');
  assert.equal(activeToken({ access_token: 'x', expires_at: Date.now() - 1, scope: '' }), null);
  assert.equal(await deleteCredentials(path), true);
  assert.equal(await loadCredentials(path), null);
  await rm(dir, { recursive: true, force: true });
});

test('resolveCredentialsPath/PendingPath respeitam GUARD_CREDENTIALS_PATH e homeDir', () => {
  assert.equal(resolveCredentialsPath({ credentialsPath: '/tmp/x.json' } as any), '/tmp/x.json');
  assert.equal(resolveCredentialsPath({ homeDir: '/home/zé' } as any), '/home/zé/.hocguard/credentials.json');
  assert.equal(resolvePendingPath({ credentialsPath: '/tmp/x.json' } as any), '/tmp/pending-login.json');
});

// --- guard_login / guard_login_check / guard_logout via MCP ------------------

let authHttp: Server;
let authBase: string;
let aprovarNoCheck = true; // controla se /oauth/device/token ja aprova

before(async () => {
  authHttp = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/oauth/device/code') {
        res.writeHead(200);
        res.end(JSON.stringify({
          device_code: 'dc-1', user_code: 'WXYZ-1234',
          verification_uri: `${authBase}/auth/device`,
          verification_uri_complete: `${authBase}/auth/device?code=WXYZ-1234`,
          expires_in: 900, interval: 1,
        }));
        return;
      }
      if (req.url === '/oauth/device/token') {
        if (aprovarNoCheck) {
          res.writeHead(200);
          res.end(JSON.stringify({ access_token: fakeJwt('user-abc'), token_type: 'Bearer', expires_in: 3600, scope: 'scan generate' }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'authorization_pending' }));
        }
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => authHttp.listen(0, '127.0.0.1', r));
  const addr = authHttp.address();
  authBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => authHttp.close());

async function mcpClient(overrides: Record<string, unknown>) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({
    apiUrl: 'http://127.0.0.1:1', tenant: 'public', requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined,
    ...overrides,
  } as any);
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

function texto(result: unknown) {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

test('guard_login devolve o link na hora e nao bloqueia; guard_login_check conclui', async () => {
  aprovarNoCheck = true;
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-login-'));
  const credPath = join(dir, 'credentials.json');
  const c = await mcpClient({ authUrl: authBase, credentialsPath: credPath });

  const login = await c.callTool({ name: 'guard_login', arguments: {} });
  assert.match(texto(login), /WXYZ-1234/);
  assert.match(texto(login), /guard_login_check/);
  // guard_login nao salvou credencial ainda (so o pendente).
  assert.equal(await loadCredentials(credPath), null);

  const check = await c.callTool({ name: 'guard_login_check', arguments: {} });
  assert.match(texto(check), /Conectado/);
  assert.match(texto(check), /user-abc/);
  const cred = await loadCredentials(credPath);
  assert.equal(cred?.access_token, fakeJwt('user-abc'));

  await c.close();
  await rm(dir, { recursive: true, force: true });
});

test('guard_login_check ainda pendente pede pra tentar de novo, sem erro', async () => {
  aprovarNoCheck = false;
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-pend-'));
  const credPath = join(dir, 'credentials.json');
  const c = await mcpClient({ authUrl: authBase, credentialsPath: credPath });

  await c.callTool({ name: 'guard_login', arguments: {} });
  const check = await c.callTool({ name: 'guard_login_check', arguments: {} });
  assert.equal((check as { isError?: boolean }).isError, undefined);
  assert.match(texto(check), /Ainda não vi a autorização/);
  assert.equal(await loadCredentials(credPath), null);

  await c.close();
  await rm(dir, { recursive: true, force: true });
});

test('guard_login_check sem login em andamento avisa', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-nopend-'));
  const c = await mcpClient({ authUrl: authBase, credentialsPath: join(dir, 'credentials.json') });
  const check = await c.callTool({ name: 'guard_login_check', arguments: {} });
  assert.match(texto(check), /Nenhum login em andamento/);
  await c.close();
  await rm(dir, { recursive: true, force: true });
});

test('guard_logout apaga a credencial', async () => {
  aprovarNoCheck = true;
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-logout-'));
  const credPath = join(dir, 'credentials.json');
  const c = await mcpClient({ authUrl: authBase, credentialsPath: credPath });
  await c.callTool({ name: 'guard_login', arguments: {} });
  await c.callTool({ name: 'guard_login_check', arguments: {} });
  assert.ok(await loadCredentials(credPath));
  const logout = await c.callTool({ name: 'guard_logout', arguments: {} });
  assert.match(texto(logout), /encerrada/i);
  await assert.rejects(access(credPath));
  await c.close();
  await rm(dir, { recursive: true, force: true });
});

// --- Bearer injetado no auditor ----------------------------------------------

test('AuditorClient manda Authorization Bearer quando ha login valido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-bearer-'));
  const credPath = join(dir, 'credentials.json');
  await writeFile(credPath, JSON.stringify({ access_token: 'meu-jwt', expires_at: Date.now() + 60_000, scope: 'scan' }));

  let auth: string | undefined;
  const auditor = createHttpServer((req, res) => {
    auth = req.headers['authorization'] as string | undefined;
    res.setHeader('content-type', 'application/json');
    res.writeHead(202);
    res.end(JSON.stringify({ job_id: 'j1', status: 'queued' }));
  });
  await new Promise<void>((r) => auditor.listen(0, '127.0.0.1', r));
  const addr = auditor.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const client = new AuditorClient({
    // D7: com login válido a varredura vai por padrão pelo core (authUrl), não
    // mais direto em apiUrl — aponta os dois pro mesmo mock (ele não olha o
    // path) pra este teste continuar focado só em "o Bearer foi mandado".
    apiUrl: base, authUrl: base, tenant: 'public', requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined, credentialsPath: credPath,
  } as any);
  await client.startScan('https://exemplo.com.br', 'lgpd');
  assert.equal(auth, 'Bearer meu-jwt');

  auditor.close();
  await rm(dir, { recursive: true, force: true });
});

test('AuditorClient NAO manda Bearer quando o login expirou', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-bearer2-'));
  const credPath = join(dir, 'credentials.json');
  await writeFile(credPath, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan' }));

  let auth: string | undefined = 'nao-mexido';
  const auditor = createHttpServer((req, res) => {
    auth = req.headers['authorization'] as string | undefined;
    res.setHeader('content-type', 'application/json');
    res.writeHead(202);
    res.end(JSON.stringify({ job_id: 'j1', status: 'queued' }));
  });
  await new Promise<void>((r) => auditor.listen(0, '127.0.0.1', r));
  const addr = auditor.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const client = new AuditorClient({
    apiUrl: base, tenant: 'public', requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined, credentialsPath: credPath,
  } as any);
  await client.startScan('https://exemplo.com.br', 'lgpd');
  assert.equal(auth, undefined);

  auditor.close();
  await rm(dir, { recursive: true, force: true });
});
