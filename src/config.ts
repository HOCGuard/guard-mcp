/**
 * Default do issuer OAuth do Guard (Device Flow, RFC 8628). Desde 04/11/2026 o
 * console e o login moram em app.hocguard.com (o discovery anuncia esse iss).
 * guard.hoc.app.br continua respondendo para instalações antigas.
 * Sobrescreva com GUARD_AUTH_URL pra outros ambientes.
 */
export const DEFAULT_AUTH_URL = 'https://app.hocguard.com';

/** Padrão de GUARD_API_URL: só serve para quem roda o consent-auditor na própria máquina. */
export const DEFAULT_API_URL = 'http://localhost:3085';

export interface Config {
  apiUrl: string;
  tenant: string;
  requestTimeoutMs: number;
  sdkUrl: string;
  /** Hguard-1434: o consent-auditor exige X-Service-Token em toda rota. */
  serviceToken: string | undefined;
  /**
   * Hguard-83: issuer do Device Flow. O guard_login abre um link aqui e faz o
   * polling do token. Default DEFAULT_AUTH_URL. Opcional: quem monta Config na
   * mão (testes) cai no default em quem consome.
   */
  authUrl?: string | undefined;
  /**
   * Caminho do arquivo de credencial do login. Default: <homeDir>/.hocguard/
   * credentials.json. Sobrescreva com GUARD_CREDENTIALS_PATH (usado nos testes
   * pra nao tocar em ~ de verdade).
   */
  credentialsPath?: string | undefined;
  /** Telemetria opt-in (GUARD_TELEMETRY=1). Desligada por padrão. */
  telemetry?: boolean;
  telemetryUrl?: string | undefined;
  /** Onde fica ~/.hocguard. Padrão: GUARD_HOME ou a home do usuário. */
  homeDir?: string | undefined;
  /**
   * Contrato Agentes de IA (Etapas 2-4), D7: com login por device flow, a
   * varredura passa pelo core (${authUrl}/api/v1/consent) em vez de ir direto
   * ao consent-auditor — assim sessão, política e limites da empresa valem
   * também pra varredura. Default true. O caminho com X-Service-Token (uso
   * interno, sem login) nunca muda: continua direto em GUARD_API_URL.
   */
  scanViaCore?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiUrl: (env['GUARD_API_URL'] ?? DEFAULT_API_URL).replace(/\/$/, ''),
    tenant: env['GUARD_TENANT'] ?? 'public',
    requestTimeoutMs: Number(env['GUARD_REQUEST_TIMEOUT_MS'] ?? 15_000),
    sdkUrl: env['GUARD_SDK_URL'] ?? 'https://cdn.hocguard.com/sdk/banner.js',
    serviceToken: env['GUARD_SERVICE_TOKEN'],
    authUrl: (env['GUARD_AUTH_URL'] ?? DEFAULT_AUTH_URL).replace(/\/$/, ''),
    credentialsPath: env['GUARD_CREDENTIALS_PATH'],
    telemetry: env['GUARD_TELEMETRY'] === '1' || env['GUARD_TELEMETRY'] === 'true',
    telemetryUrl: env['GUARD_TELEMETRY_URL'],
    homeDir: env['GUARD_HOME'],
    scanViaCore: env['GUARD_SCAN_VIA_CORE'] === undefined ? true : env['GUARD_SCAN_VIA_CORE'] !== '0' && env['GUARD_SCAN_VIA_CORE'] !== 'false',
  };
}
