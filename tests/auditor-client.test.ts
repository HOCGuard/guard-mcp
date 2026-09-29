import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { AuditorClient, AuditorError } from '../src/auditor-client.ts';
import type { Config } from '../src/config.ts';
import type { TokenProvider } from '../src/auth/session.ts';

// Contrato Agentes de IA (Etapas 2-4), D7/4.9 e seção 9: com login por device
// flow, a varredura passa a atravessar o core (${authUrl}/api/v1/consent) em
// vez de ir direto ao consent-auditor, para que sessão, política e limites da
// empresa valham também para a varredura. Sem login (uso interno via
// X-Service-Token), o caminho direto em GUARD_API_URL não muda.

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

type Chamada = { method: string; url: string; auth: string | undefined; serviceToken: string | undefined };

async function mockServer(handler: (c: Chamada) => { status: number; body?: unknown }): Promise<{ url: string; chamadas: Chamada[] }> {
  const chamadas: Chamada[] = [];
  const http = createHttpServer((req, res) => {
    const c: Chamada = {
      method: req.method ?? 'GET',
      url: req.url ?? '',
      auth: req.headers['authorization'] as string | undefined,
      serviceToken: req.headers['x-service-token'] as string | undefined,
    };
    chamadas.push(c);
    const r = handler(c);
    res.setHeader('content-type', 'application/json');
    res.writeHead(r.status);
    res.end(r.body === undefined ? '' : JSON.stringify(r.body));
  });
  servers.push(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const addr = http.address();
  return { url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chamadas };
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiUrl: 'http://127.0.0.1:1', // porta morta: prova que o teste NÃO caiu aqui quando não deveria
    tenant: 'public',
    requestTimeoutMs: 2000,
    sdkUrl: 'https://guard.test/sdk/banner.js',
    serviceToken: undefined,
    authUrl: 'https://auth.test',
    ...overrides,
  };
}

function fakeTokens(overrides: Partial<TokenProvider> = {}): TokenProvider {
  return { currentToken: async () => null, forceRefresh: async () => null, ...overrides };
}

// --- base URL --------------------------------------------------------------

test('sem login (bearer null): vai direto ao consent-auditor em GUARD_API_URL, com X-Service-Token', async () => {
  const auditor = await mockServer((c) => {
    assert.equal(c.serviceToken, 'segredo');
    assert.equal(c.auth, undefined);
    return { status: 200, body: { job_id: '1', status: 'running' } };
  });
  const client = new AuditorClient(
    baseConfig({ apiUrl: auditor.url, serviceToken: 'segredo' }),
    fakeTokens(),
  );
  const status = await client.getStatus('1');
  assert.equal(status.status, 'running');
  assert.equal(auditor.chamadas.length, 1);
});

test('logado (bearer, GUARD_SCAN_VIA_CORE default true): vai pelo core (authUrl + /api/v1/consent), nunca em GUARD_API_URL', async () => {
  const core = await mockServer((c) => {
    assert.equal(c.url, '/api/v1/consent/audit/9/status');
    assert.equal(c.auth, 'Bearer jwt-do-usuario');
    return { status: 200, body: { job_id: '9', status: 'completed' } };
  });
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }), // apiUrl continua em porta morta (127.0.0.1:1)
    fakeTokens({ currentToken: async () => 'jwt-do-usuario' }),
  );
  const status = await client.getStatus('9');
  assert.equal(status.status, 'completed');
  assert.equal(core.chamadas.length, 1);
});

test('GUARD_SCAN_VIA_CORE=false: mesmo logado, continua indo direto em GUARD_API_URL', async () => {
  const auditor = await mockServer((c) => {
    assert.equal(c.auth, 'Bearer jwt-do-usuario');
    return { status: 200, body: { job_id: '1', status: 'queued' } };
  });
  const client = new AuditorClient(
    baseConfig({ apiUrl: auditor.url, scanViaCore: false }),
    fakeTokens({ currentToken: async () => 'jwt-do-usuario' }),
  );
  const status = await client.getStatus('1');
  assert.equal(status.status, 'queued');
  assert.equal(auditor.chamadas.length, 1);
});

// --- erros -------------------------------------------------------------------

test('403 urn:hoc:error:agent:blocked: mensagem é o detail de negócio, sem retry (uma chamada só)', async () => {
  const core = await mockServer(() => ({
    status: 403,
    body: { type: 'urn:hoc:error:agent:blocked', title: 'Agente bloqueado', status: 403, detail: 'A empresa não liberou varredura para agentes de IA.', motivo: 'area-sem-acesso' },
  }));
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }),
    fakeTokens({ currentToken: async () => 'jwt-do-usuario' }),
  );
  await assert.rejects(
    () => client.getStatus('1'),
    (err: unknown) => {
      assert.ok(err instanceof AuditorError);
      assert.equal(err.message, 'A empresa não liberou varredura para agentes de IA.');
      assert.equal(err.status, 403);
      assert.equal(err.code, 'area-sem-acesso');
      return true;
    },
  );
  assert.equal(core.chamadas.length, 1);
});

test('429 urn:hoc:error:agent:blocked (limite diário): mensagem é o detail, sem retry', async () => {
  const core = await mockServer(() => ({
    status: 429,
    body: { type: 'urn:hoc:error:agent:blocked', title: 'Agente bloqueado', status: 429, detail: 'Agente de IA (HOC Guard MCP) chegou ao limite de 5 varreduras hoje.', motivo: 'limite-varreduras' },
  }));
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }),
    fakeTokens({ currentToken: async () => 'jwt-do-usuario' }),
  );
  await assert.rejects(
    () => client.getStatus('1'),
    (err: unknown) => {
      assert.ok(err instanceof AuditorError);
      assert.match(err.message, /limite de 5 varreduras hoje/);
      assert.equal(err.status, 429);
      assert.equal(err.code, 'limite-varreduras');
      return true;
    },
  );
  assert.equal(core.chamadas.length, 1);
});

test('403 comum (não agent:blocked) com bearer: mensagem de login expirado (comportamento existente)', async () => {
  const core = await mockServer(() => ({ status: 403, body: { error: 'forbidden' } }));
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }),
    fakeTokens({ currentToken: async () => 'jwt-do-usuario' }),
  );
  await assert.rejects(
    () => client.getStatus('1'),
    (err: unknown) => {
      assert.ok(err instanceof AuditorError);
      assert.match(err.message, /login do Guard expirou/);
      return true;
    },
  );
});

// --- 401 / refresh / lock (comportamento existente, agora também via core) ---

test('401 com bearer: pede forceRefresh e repete UMA vez com o token novo, no mesmo destino (via core)', async () => {
  let chamadasRefresh = 0;
  const core = await mockServer((c) => {
    if (c.auth === 'Bearer expirado') return { status: 401, body: { error: 'expired' } };
    assert.equal(c.auth, 'Bearer renovado');
    return { status: 200, body: { job_id: '1', status: 'completed' } };
  });
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }),
    fakeTokens({
      currentToken: async () => 'expirado',
      forceRefresh: async () => {
        chamadasRefresh++;
        return 'renovado';
      },
    }),
  );
  const status = await client.getStatus('1');
  assert.equal(status.status, 'completed');
  assert.equal(chamadasRefresh, 1);
  assert.equal(core.chamadas.length, 2);
});

test('401 e forceRefresh falha (sessão morta): não insiste, mensagem pede guard_login', async () => {
  const core = await mockServer(() => ({ status: 401, body: { error: 'expired' } }));
  const client = new AuditorClient(
    baseConfig({ authUrl: core.url }),
    fakeTokens({ currentToken: async () => 'expirado', forceRefresh: async () => null }),
  );
  await assert.rejects(
    () => client.getStatus('1'),
    (err: unknown) => {
      assert.ok(err instanceof AuditorError);
      assert.match(err.message, /guard_login|login do Guard expirou/i);
      return true;
    },
  );
  assert.equal(core.chamadas.length, 1); // sem bearer novo, não repete
});

test('401 sem bearer nenhum (uso interno, sem login): não tenta refresh, erro genérico do status', async () => {
  const auditor = await mockServer(() => ({ status: 401, body: { error: 'sem token' } }));
  const client = new AuditorClient(
    baseConfig({ apiUrl: auditor.url, serviceToken: 'segredo-invalido' }),
    fakeTokens(), // currentToken() => null
  );
  await assert.rejects(() => client.getStatus('1'), AuditorError);
  assert.equal(auditor.chamadas.length, 1);
});
