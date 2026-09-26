export interface Config {
  apiUrl: string;
  tenant: string;
  requestTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiUrl: (env['GUARD_API_URL'] ?? 'http://localhost:3085').replace(/\/$/, ''),
    tenant: env['GUARD_TENANT'] ?? 'public',
    requestTimeoutMs: Number(env['GUARD_REQUEST_TIMEOUT_MS'] ?? 15_000),
  };
}
