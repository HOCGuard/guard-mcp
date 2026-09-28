import type { Config } from './config.ts';
import type { RawReport } from './findings.ts';
import { createTokenProvider, type TokenProvider } from './auth/session.ts';

export interface StartedScan {
  job_id: string;
  estimated_duration_seconds?: number;
}

export interface ScanStatus {
  job_id: string;
  status: string;
  elapsed_ms?: number;
}

export class AuditorError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuditorError';
    this.status = status;
  }
}

export class AuditorClient {
  readonly #config: Config;
  readonly #tokens: TokenProvider;

  constructor(config: Config, tokens?: TokenProvider) {
    this.#config = config;
    this.#tokens = tokens ?? createTokenProvider(config);
  }

  private async doFetch(path: string, bearer: string | null, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.#config.apiUrl}${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          // X-Service-Token continua valendo pra uso interno; o Bearer do login
          // e o caminho por usuario. Manda os dois quando existirem.
          ...(this.#config.serviceToken ? { 'X-Service-Token': this.#config.serviceToken } : {}),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        signal: AbortSignal.timeout(this.#config.requestTimeoutMs),
      });
    } catch (cause) {
      throw new AuditorError(
        `Não foi possível falar com o serviço de varredura em ${this.#config.apiUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let bearer = await this.#tokens.currentToken();
    let response = await this.doFetch(path, bearer, init);

    // Retry único em 401: o token local parecia válido mas o servidor recusou
    // (revogado, ou perdeu a corrida de uma renovação concorrente). Só faz
    // sentido tentar de novo se um bearer foi de fato usado.
    if (bearer && response.status === 401) {
      const renewed = await this.#tokens.forceRefresh();
      if (renewed) {
        bearer = renewed;
        response = await this.doFetch(path, bearer, init);
      }
    }

    const body = await response.text();
    if (!response.ok) {
      // Login expirado/invalido no meio do caminho: mensagem acionavel.
      if (bearer && (response.status === 401 || response.status === 403)) {
        throw new AuditorError('Seu login do Guard expirou ou não vale pra este domínio. Rode guard_login de novo.', response.status);
      }
      throw new AuditorError(extractDetail(body) ?? `Serviço respondeu ${response.status}`, response.status);
    }
    return body ? (JSON.parse(body) as T) : ({} as T);
  }

  async startScan(url: string, framework: string): Promise<StartedScan> {
    return this.request<StartedScan>('/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        framework,
        cod_empresa: this.#config.tenant,
        options: { capture_screenshots: false },
      }),
    });
  }

  async getStatus(jobId: string): Promise<ScanStatus> {
    return this.request<ScanStatus>(`/audit/${encodeURIComponent(jobId)}/status`);
  }

  async getReport(jobId: string): Promise<RawReport> {
    return this.request<RawReport>(`/audit/${encodeURIComponent(jobId)}/report`);
  }
}

function extractDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { detail?: string; error?: string };
    return parsed.detail ?? parsed.error;
  } catch {
    return undefined;
  }
}
