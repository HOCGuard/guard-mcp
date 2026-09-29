import type { Config } from './config.ts';
import { DEFAULT_AUTH_URL } from './config.ts';
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
  /** Código estável do motivo (contrato Agentes de IA, motivos.ts), quando o servidor manda um. */
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'AuditorError';
    this.status = status;
    this.code = code;
  }
}

export class AuditorClient {
  readonly #config: Config;
  readonly #tokens: TokenProvider;
  readonly #authOrigin: string;

  constructor(config: Config, tokens?: TokenProvider) {
    this.#config = config;
    this.#tokens = tokens ?? createTokenProvider(config);
    this.#authOrigin = new URL(config.authUrl ?? DEFAULT_AUTH_URL).origin;
  }

  // Contrato Agentes de IA (Etapas 2-4), D7: logado por device flow (bearer) e
  // com GUARD_SCAN_VIA_CORE ligado (default true), a varredura atravessa o core
  // (${authUrl}/api/v1/consent) em vez de ir direto ao consent-auditor — assim
  // sessão, política e limites da empresa valem também para a varredura. Sem
  // login (uso interno com X-Service-Token, sem bearer), o caminho direto em
  // GUARD_API_URL não muda.
  private targetBase(bearer: string | null): string {
    if (bearer && this.#config.scanViaCore !== false) return `${this.#authOrigin}/api/v1/consent`;
    return this.#config.apiUrl;
  }

  private async doFetch(base: string, path: string, bearer: string | null, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${base}${path}`, {
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
        `Não foi possível falar com o serviço de varredura em ${base}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let bearer = await this.#tokens.currentToken();
    let base = this.targetBase(bearer);
    let response = await this.doFetch(base, path, bearer, init);

    // Retry único em 401: o token local parecia válido mas o servidor recusou
    // (revogado, ou perdeu a corrida de uma renovação concorrente). Só faz
    // sentido tentar de novo se um bearer foi de fato usado.
    if (bearer && response.status === 401) {
      const renewed = await this.#tokens.forceRefresh();
      if (renewed) {
        bearer = renewed;
        base = this.targetBase(bearer);
        response = await this.doFetch(base, path, bearer, init);
      }
    }

    const body = await response.text();
    if (!response.ok) throw errorFrom(response.status, body, bearer !== null);
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

function parseBody(body: string): { type?: string; detail?: string; motivo?: string; error?: string } | undefined {
  try {
    return JSON.parse(body) as ReturnType<typeof parseBody>;
  } catch {
    return undefined;
  }
}

function extractDetail(body: string): string | undefined {
  const parsed = parseBody(body);
  return parsed?.detail ?? parsed?.error;
}

// Sem retry (só há retry em 401, em request() acima).
function errorFrom(status: number, body: string, hadBearer: boolean): AuditorError {
  const parsed = parseBody(body);

  // Contrato Agentes de IA (Etapas 2-4), D2/4.2: guardrail da empresa aplicado
  // no core (tenant-auth), antes do consent-auditor ver a requisição. Mesmo
  // corpo para bloqueio reversível (403: fora do horário, área sem acesso,
  // conexão pausada por limite...) e limite diário de varreduras estourado
  // (429): "detail" já é o texto de negócio em PT-BR (motivos.ts) pronto para
  // o agente repassar ao modelo; "motivo" é o código estável.
  if (parsed?.type === 'urn:hoc:error:agent:blocked') {
    return new AuditorError(parsed.detail ?? 'O Guard bloqueou esta varredura para agentes de IA.', status, parsed.motivo);
  }
  // Login expirado/invalido no meio do caminho: mensagem acionavel.
  if (hadBearer && (status === 401 || status === 403)) {
    return new AuditorError('Seu login do Guard expirou ou não vale pra este domínio. Rode guard_login de novo.', status);
  }
  return new AuditorError(extractDetail(body) ?? `Serviço respondeu ${status}`, status);
}
