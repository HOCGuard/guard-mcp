import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenProvider } from '../src/auth/session.ts';
import type { Config } from '../src/config.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function tmpCredPath(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hocguard-session-'));
  return { dir, path: join(dir, 'credentials.json') };
}

function baseConfig(credentialsPath: string): Config {
  return {
    apiUrl: 'http://127.0.0.1:1',
    tenant: 'public',
    requestTimeoutMs: 5000,
    sdkUrl: 'https://guard.test/sdk/banner.js',
    serviceToken: undefined,
    authUrl: 'https://auth.test',
    credentialsPath,
  };
}

// --- renova ao expirar ---------------------------------------------------------

test('currentToken devolve o access_token direto quando ainda é válido, sem tocar na rede', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'valido', expires_at: Date.now() + 60_000, scope: 'scan', refresh_token: 'rt-1' }));
  let calls = 0;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl: (async () => { calls++; throw new Error('não deveria chamar a rede'); }) as unknown as typeof fetch });
  const token = await tokens.currentToken();
  assert.equal(token, 'valido');
  assert.equal(calls, 0);
  await rm(dir, { recursive: true, force: true });
});

test('currentToken renova sozinho quando o access_token expirou e há refresh_token', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-1' }));

  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://auth.test/oauth/token');
    const body = new URLSearchParams(init.body as string);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'rt-1');
    assert.equal(body.get('client_id'), 'guard-mcp');
    return jsonResponse(200, { access_token: 'novo', token_type: 'Bearer', expires_in: 3600, scope: 'scan', refresh_token: 'rt-2' });
  }) as unknown as typeof fetch;

  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });
  const token = await tokens.currentToken();
  assert.equal(token, 'novo');

  // rotação: a credencial em disco tem o refresh_token NOVO.
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.access_token, 'novo');
  assert.equal(saved.refresh_token, 'rt-2');
  await rm(dir, { recursive: true, force: true });
});

test('currentToken devolve null (sem tentar renovar) quando expirou e não há refresh_token (credencial antiga)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan' }));
  let calls = 0;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl: (async () => { calls++; throw new Error('não deveria chamar a rede'); }) as unknown as typeof fetch });
  const token = await tokens.currentToken();
  assert.equal(token, null);
  assert.equal(calls, 0);
  await rm(dir, { recursive: true, force: true });
});

test('currentToken devolve null quando nunca logou', async () => {
  const { dir, path } = await tmpCredPath();
  const tokens = createTokenProvider(baseConfig(path));
  assert.equal(await tokens.currentToken(), null);
  await rm(dir, { recursive: true, force: true });
});

test('mantém o refresh_token antigo se o servidor não mandar um novo (sem rotação)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-1' }));
  const fetchImpl = (async () => jsonResponse(200, { access_token: 'novo', token_type: 'Bearer', expires_in: 3600, scope: 'scan' })) as unknown as typeof fetch;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });
  await tokens.currentToken();
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.refresh_token, 'rt-1');
  await rm(dir, { recursive: true, force: true });
});

// --- lock de concorrência --------------------------------------------------------

test('duas renovações concorrentes usam o refresh_token UMA vez só (lock em memória)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-1' }));

  let refreshCalls = 0;
  const fetchImpl = (async () => {
    refreshCalls++;
    // Simula latência de rede pra garantir que as duas chamadas concorrentes
    // caiam dentro da janela do lock.
    await new Promise((r) => setTimeout(r, 30));
    return jsonResponse(200, { access_token: `novo-${refreshCalls}`, token_type: 'Bearer', expires_in: 3600, scope: 'scan', refresh_token: `rt-${refreshCalls + 1}` });
  }) as unknown as typeof fetch;

  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });
  const [a, b] = await Promise.all([tokens.currentToken(), tokens.currentToken()]);

  assert.equal(refreshCalls, 1, 'esperava UMA chamada de refresh pras duas concorrentes');
  assert.equal(a, b);
  assert.equal(a, 'novo-1');
  await rm(dir, { recursive: true, force: true });
});

test('depois que o lock libera, uma nova renovação é permitida (não fica travado pra sempre)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-1' }));
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return jsonResponse(200, { access_token: `novo-${calls}`, token_type: 'Bearer', expires_in: -1000, scope: 'scan', refresh_token: `rt-${calls + 1}` });
  }) as unknown as typeof fetch;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });
  await tokens.currentToken();
  // expires_in negativo: o token "novo" já nasce expirado, então uma segunda
  // chamada exige uma NOVA renovação (prova que o lock não ficou preso).
  await tokens.currentToken();
  assert.equal(calls, 2);
  await rm(dir, { recursive: true, force: true });
});

// --- invalid_grant ---------------------------------------------------------------

test('invalid_grant na renovação limpa a credencial em disco e devolve null', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-revogado' }));
  const fetchImpl = (async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'refresh token revogado' })) as unknown as typeof fetch;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });

  const token = await tokens.currentToken();
  assert.equal(token, null);
  await assert.rejects(readFile(path, 'utf8'));
  await rm(dir, { recursive: true, force: true });
});

test('erro de rede na renovação NÃO apaga a credencial (é transitório, pode tentar de novo depois)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'velho', expires_at: Date.now() - 1000, scope: 'scan', refresh_token: 'rt-1' }));
  const fetchImpl = (async () => { throw new Error('rede caiu'); }) as unknown as typeof fetch;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });

  const token = await tokens.currentToken();
  assert.equal(token, null);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.refresh_token, 'rt-1');
  await rm(dir, { recursive: true, force: true });
});

// --- forceRefresh (retry em 401) --------------------------------------------------

test('forceRefresh renova mesmo com o access_token local ainda "válido" (usado no retry de 401)', async () => {
  const { dir, path } = await tmpCredPath();
  await writeFile(path, JSON.stringify({ access_token: 'aceito-localmente-mas-revogado-no-servidor', expires_at: Date.now() + 60_000, scope: 'scan', refresh_token: 'rt-1' }));
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return jsonResponse(200, { access_token: 'renovado', token_type: 'Bearer', expires_in: 3600, scope: 'scan', refresh_token: 'rt-2' });
  }) as unknown as typeof fetch;
  const tokens = createTokenProvider(baseConfig(path), { fetchImpl });
  const renewed = await tokens.forceRefresh();
  assert.equal(renewed, 'renovado');
  assert.equal(calls, 1);
  await rm(dir, { recursive: true, force: true });
});
