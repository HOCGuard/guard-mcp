// Cliente do OAuth 2.0 Device Authorization Grant (RFC 8628). Fala com o
// auth_server do Guard (issuer configurável). fetch e sleep são injetáveis pra
// os testes rodarem sem rede e sem espera real.

export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const GUARD_MCP_CLIENT_ID = 'guard-mcp';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  /** Sessão de agente (Etapa 1): presente quando o servidor já emite refresh_token. */
  refresh_token?: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  /** Rotação: o servidor troca o refresh_token a cada renovação. */
  refresh_token?: string;
}

export class DeviceFlowError extends Error {
  /** Código OAuth cru (ex: "invalid_grant"), quando disponível. */
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DeviceFlowError';
    this.code = code;
  }
}

type FetchImpl = typeof fetch;

interface ClientOpts {
  fetchImpl?: FetchImpl;
}

// Resultado de UMA tentativa de polling. O tool guard_login_check mapeia cada
// kind numa mensagem pro usuário, sem bloquear.
export type PollResult =
  | { kind: 'token'; token: DeviceTokenResponse }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' };

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    return body.error_description ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Passo 1 (RFC 8628 §3.1): pede device_code + user_code. agentName/agentClient
// (Etapa 1: sessões de agente) identificam o cliente MCP pro backend nomear a
// sessão; omitidos, o backend usa seus próprios defaults.
export async function requestDeviceCode(
  authUrl: string,
  params: { clientId: string; scope: string; agentName?: string | undefined; agentClient?: string | undefined },
  opts: ClientOpts = {},
): Promise<DeviceCodeResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const bodyParams: Record<string, string> = { client_id: params.clientId, scope: params.scope };
  if (params.agentName) bodyParams['agent_name'] = params.agentName;
  if (params.agentClient) bodyParams['agent_client'] = params.agentClient;
  const body = new URLSearchParams(bodyParams);
  let res: Response;
  try {
    res = await fetchImpl(`${authUrl}/oauth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new DeviceFlowError(
      `Não foi possível falar com o login do Guard em ${authUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!res.ok) {
    throw new DeviceFlowError(`Falha ao iniciar o login: ${await parseError(res)}`);
  }
  return (await res.json()) as DeviceCodeResponse;
}

// Passo 2 (RFC 8628 §3.4/3.5): UMA tentativa de polling. Não bloqueia: devolve o
// estado atual (token, pending, slow_down, expired, denied). Quem decide esperar
// e tentar de novo é o chamador (o usuário rodando guard_login_check).
export async function pollOnce(
  authUrl: string,
  params: { clientId: string; deviceCode: string },
  opts: ClientOpts = {},
): Promise<PollResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: params.deviceCode,
    client_id: params.clientId,
  });

  let res: Response;
  try {
    res = await fetchImpl(`${authUrl}/oauth/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new DeviceFlowError(
      `Não foi possível falar com o login do Guard: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (res.ok) {
    return { kind: 'token', token: (await res.json()) as DeviceTokenResponse };
  }

  let error = 'invalid_request';
  try {
    error = ((await res.json()) as { error?: string }).error ?? error;
  } catch {
    // mantem invalid_request
  }

  switch (error) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'expired_token':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    default:
      throw new DeviceFlowError(`Login falhou: ${error}`);
  }
}

// Renova o access_token com o refresh_token guardado (grant refresh_token, RFC
// 6749 §6). O servidor roda rotação + reuse detection: cada chamada aqui só
// pode usar o refresh_token UMA vez (quem chama garante isso com um lock, ver
// src/auth/session.ts). Em erro, o `code` da DeviceFlowError distingue
// "invalid_grant" (sessão morta: precisa de guard_login de novo) de qualquer
// outro problema (rede, servidor fora, etc).
export async function refreshAccessToken(
  authUrl: string,
  params: { clientId: string; refreshToken: string },
  opts: ClientOpts = {},
): Promise<RefreshTokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  let res: Response;
  try {
    res = await fetchImpl(`${authUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new DeviceFlowError(
      `Não foi possível falar com o login do Guard em ${authUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!res.ok) {
    let error = 'invalid_request';
    let description: string | undefined;
    try {
      const parsed = (await res.json()) as { error?: string; error_description?: string };
      error = parsed.error ?? error;
      description = parsed.error_description;
    } catch {
      // mantem invalid_request
    }
    throw new DeviceFlowError(description ?? `Falha ao renovar o login: ${error}`, error);
  }
  return (await res.json()) as RefreshTokenResponse;
}

// Revoga um refresh_token (RFC 7009). Best-effort: chamado no guard_logout pra
// derrubar a sessão no servidor também, mas nunca impede o logout local — quem
// chama ignora o erro.
export async function revokeToken(
  authUrl: string,
  params: { clientId: string; token: string },
  opts: ClientOpts = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({ token: params.token, client_id: params.clientId });
  await fetchImpl(`${authUrl}/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

// Lê o claim sub do JWT (sem verificar assinatura, só pra dar nome ao "Conectado
// como X"). Verificação de verdade é do auditor via JWKS.
export function decodeJwtSubject(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
