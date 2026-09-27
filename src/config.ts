export interface Config {
  apiUrl: string;
  tenant: string;
  requestTimeoutMs: number;
  sdkUrl: string;
  /** Hguard-1434: o consent-auditor exige X-Service-Token em toda rota. */
  serviceToken: string | undefined;
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
    telemetry: env['GUARD_TELEMETRY'] === '1' || env['GUARD_TELEMETRY'] === 'true',
    telemetryUrl: env['GUARD_TELEMETRY_URL'],
  };
}
