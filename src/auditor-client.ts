import type { Config } from './config.ts';
import type { RawReport } from './findings.ts';

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

  constructor(config: Config) {
    this.#config = config;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#config.apiUrl}${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          ...(this.#config.serviceToken ? { 'X-Service-Token': this.#config.serviceToken } : {}),
        },
        signal: AbortSignal.timeout(this.#config.requestTimeoutMs),
      });
    } catch (cause) {
      throw new AuditorError(
        `Não foi possível falar com o serviço de varredura em ${this.#config.apiUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
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
