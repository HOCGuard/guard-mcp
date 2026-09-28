/** Default do issuer OAuth do Guard (Device Flow, RFC 8628). */
export const DEFAULT_AUTH_URL = 'https://auth.grupohoc.com.br';

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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiUrl: (env['GUARD_API_URL'] ?? 'http://localhost:3085').replace(/\/$/, ''),
    tenant: env['GUARD_TENANT'] ?? 'public',
    requestTimeoutMs: Number(env['GUARD_REQUEST_TIMEOUT_MS'] ?? 15_000),
    sdkUrl: env['GUARD_SDK_URL'] ?? 'https://guard.hoc.app.br/sdk/banner.js',
    serviceToken: env['GUARD_SERVICE_TOKEN'],
    authUrl: (env['GUARD_AUTH_URL'] ?? DEFAULT_AUTH_URL).replace(/\/$/, ''),
    credentialsPath: env['GUARD_CREDENTIALS_PATH'],
    telemetry: env['GUARD_TELEMETRY'] === '1' || env['GUARD_TELEMETRY'] === 'true',
    telemetryUrl: env['GUARD_TELEMETRY_URL'],
    homeDir: env['GUARD_HOME'],
  };
}
