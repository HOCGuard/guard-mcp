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
  pollForToken,
  decodeJwtSubject,
  DeviceFlowError,
} from '../src/auth/device-flow.ts';
import {
  resolveCredentialsPath,
  saveCredentials,
  loadCredentials,
  activeToken,
  deleteCredentials,
} from '../src/credentials.ts';

const noSleep = async () => {};

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

test('pollForToken espera authorization_pending e depois recebe o token', async () => {
  const respostas = [
    jsonResponse(400, { error: 'authorization_pending' }),
    jsonResponse(400, { error: 'authorization_pending' }),
    jsonResponse(200, { access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, scope: 'scan generate' }),
  ];
  let i = 0;
  const fetchImpl = (async () => respostas[i++]!) as unknown as typeof fetch;
  const token = await pollForToken(
    'https://auth.x',
    { clientId: 'guard-mcp', deviceCode: 'dc', interval: 1, expiresIn: 900 },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(token.access_token, 'jwt');
  assert.equal(i, 3);
});

test('pollForToken trata slow_down e continua', async () => {
  const respostas = [
    jsonResponse(400, { error: 'slow_down' }),
    jsonResponse(200, { access_token: 'jwt', token_type: 'Bearer', expires_in: 3600, scope: 'scan' }),
  ];
  let i = 0;
  const fetchImpl = (async () => respostas[i++]!) as unknown as typeof fetch;
  const token = await pollForToken('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc', interval: 1, expiresIn: 900 }, { fetchImpl, sleep: noSleep });
  assert.equal(token.access_token, 'jwt');
});

test('pollForToken lanca em expired_token e em access_denied', async () => {
  const expira = (async () => jsonResponse(400, { error: 'expired_token' })) as unknown as typeof fetch;
  await assert.rejects(
    pollForToken('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc', interval: 1, expiresIn: 900 }, { fetchImpl: expira, sleep: noSleep }),
    (e: unknown) => e instanceof DeviceFlowError && /expirou/.test((e as Error).message),
  );
  const negado = (async () => jsonResponse(400, { error: 'access_denied' })) as unknown as typeof fetch;
  await assert.rejects(
    pollForToken('https://auth.x', { clientId: 'guard-mcp', deviceCode: 'dc', interval: 1, expiresIn: 900 }, { fetchImpl: negado, sleep: noSleep }),
    (e: unknown) => e instanceof DeviceFlowError && /negada/.test((e as Error).message),
  );
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
  // expirado -> null
  assert.equal(activeToken({ access_token: 'x', expires_at: Date.now() - 1, scope: '' }), null);
  assert.equal(await deleteCredentials(path), true);
  assert.equal(await loadCredentials(path), null);
  await rm(dir, { recursive: true, force: true });
});

test('resolveCredentialsPath respeita GUARD_CREDENTIALS_PATH e homeDir', () => {
  assert.equal(resolveCredentialsPath({ credentialsPath: '/tmp/x.json' } as any), '/tmp/x.json');
  assert.equal(resolveCredentialsPath({ homeDir: '/home/zé' } as any), '/home/zé/.hocguard/credentials.json');
});

// --- guard_login / guard_logout via MCP --------------------------------------

let authHttp: Server;
let authBase: string;

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
        // Aprovacao imediata (sem pending) pra o teste nao esperar.
        res.writeHead(200);
        res.end(JSON.stringify({ access_token: fakeJwt('user-abc'), token_type: 'Bearer', expires_in: 3600, scope: 'scan generate' }));
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

test('guard_login conecta, salva credencial e guard_logout apaga', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-login-'));
  const credPath = join(dir, 'credentials.json');
  const c = await mcpClient({ authUrl: authBase, credentialsPath: credPath });

  const login = await c.callTool({ name: 'guard_login', arguments: {} });
  const texto = (login as { content: { text: string }[] }).content[0]!.text;
  assert.match(texto, /Conectado/);
  assert.match(texto, /user-abc/);

  const cred = await loadCredentials(credPath);
  assert.equal(cred?.access_token, fakeJwt('user-abc'));
  assert.equal(cred?.scope, 'scan generate');

  const logout = await c.callTool({ name: 'guard_logout', arguments: {} });
  assert.match((logout as { content: { text: string }[] }).content[0]!.text, /encerrada/i);
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
    apiUrl: base, tenant: 'public', requestTimeoutMs: 5000,
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
