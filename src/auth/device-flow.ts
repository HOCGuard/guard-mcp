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
}

export class DeviceFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceFlowError';
  }
}

type FetchImpl = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

interface ClientOpts {
  fetchImpl?: FetchImpl;
  sleep?: Sleep;
}

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    return body.error_description ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Passo 1 (RFC 8628 §3.1): pede device_code + user_code.
export async function requestDeviceCode(
  authUrl: string,
  params: { clientId: string; scope: string },
  opts: ClientOpts = {},
): Promise<DeviceCodeResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({ client_id: params.clientId, scope: params.scope });
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

// Passo 2 (RFC 8628 §3.4/3.5): faz polling até aprovar, negar ou expirar.
// Respeita authorization_pending, slow_down (aumenta o intervalo) e expired_token.
export async function pollForToken(
  authUrl: string,
  params: { clientId: string; deviceCode: string; interval: number; expiresIn: number },
  opts: ClientOpts = {},
): Promise<DeviceTokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let intervalSeconds = Math.max(1, params.interval || 5);
  const deadline = Date.now() + params.expiresIn * 1000;

  const body = new URLSearchParams({
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: params.deviceCode,
    client_id: params.clientId,
  });

  for (;;) {
    if (Date.now() >= deadline) {
      throw new DeviceFlowError('O código expirou antes da autorização. Rode guard_login de novo.');
    }

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
      return (await res.json()) as DeviceTokenResponse;
    }

    let error = 'invalid_request';
    try {
      error = ((await res.json()) as { error?: string }).error ?? error;
    } catch {
      // mantem invalid_request
    }

    switch (error) {
      case 'authorization_pending':
        await sleep(intervalSeconds * 1000);
        break;
      case 'slow_down':
        intervalSeconds += 5;
        await sleep(intervalSeconds * 1000);
        break;
      case 'expired_token':
        throw new DeviceFlowError('O código expirou. Rode guard_login de novo.');
      case 'access_denied':
        throw new DeviceFlowError('Autorização negada no navegador.');
      default:
        throw new DeviceFlowError(`Login falhou: ${error}`);
    }
  }
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
