import type { Config } from './config.ts';
import { DEFAULT_API_URL, DEFAULT_AUTH_URL } from './config.ts';
import type { RawReport } from './findings.ts';
import { createTokenProvider, type TokenProvider } from './auth/session.ts';
import type { ScanFailure } from './scan-failure.ts';
import { GCC_SCAN_PREFIX, failureCodeOf, reportLink, type GccRelatorio } from './gcc-report.ts';

export interface StartedScan {
  job_id: string;
  estimated_duration_seconds?: number;
  /** Hguard-2582: análise pelo gcc, que entra em Sites; link do relatório no Guard. */
  link?: string;
}

export interface ScanStatus {
  job_id: string;
  status: string;
  elapsed_ms?: number;
  /** Hguard-2578: só em status failed. */
  failure?: ScanFailure;
  link?: string;
}

// Hguard-2582: motivos do portão/gcc que dizem "esta rota ainda não existe
// para agentes" (servidor anterior à varredura pelo gcc). Aí volta ao caminho
// de antes em vez de falhar.
// insufficient-scope: o papel perdeu gcc:audit:* com o token ainda vivo; o
// caminho de antes, com scan, ainda serve.
const ROTA_AINDA_FECHADA = new Set(['rota-nao-permitida', 'agent-route-not-allowed', 'insufficient-scope']);
// Id de análise do gcc (ULID/UUID): nada de barra, ponto ou outro caractere de caminho.
const ID_ANALISE = /^[A-Za-z0-9_-]{1,64}$/;

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

  /** Login com gcc:audit:* e varredura pelo core ligada: a análise vai pelo gcc (Hguard-2582). */
  private async viaGcc(): Promise<boolean> {
    if (this.#config.scanViaCore === false) return false;
    if (!(await this.#tokens.currentToken())) return false;
    const scopes = (await this.#tokens.currentScopes?.()) ?? [];
    return scopes.includes('gcc:audit:write') && scopes.includes('gcc:audit:read');
  }

  private async request<T>(path: string, init?: RequestInit, base0?: string): Promise<T> {
    let bearer = await this.#tokens.currentToken();
    // Hguard-2583: sem login, sem token de serviço e com o GUARD_API_URL padrão
    // não há para onde ir; antes isso virava "fetch failed" em localhost.
    if (!bearer && !this.#config.serviceToken && this.#config.apiUrl === DEFAULT_API_URL) {
      throw new AuditorError('A varredura precisa do login no HOC Guard. Rode guard_login, conclua com guard_login_check e varra de novo.');
    }
    let base = base0 ?? this.targetBase(bearer);
    let response = await this.doFetch(base, path, bearer, init);

    // Retry único em 401: o token local parecia válido mas o servidor recusou
    // (revogado, ou perdeu a corrida de uma renovação concorrente). Só faz
    // sentido tentar de novo se um bearer foi de fato usado.
    if (bearer && response.status === 401) {
      const renewed = await this.#tokens.forceRefresh();
      if (renewed) {
        bearer = renewed;
        base = base0 ?? this.targetBase(bearer);
        response = await this.doFetch(base, path, bearer, init);
      }
    }

    const body = await response.text();
    if (!response.ok) throw errorFrom(response.status, body, bearer !== null);
    return body ? (JSON.parse(body) as T) : ({} as T);
  }

  async startScan(url: string, framework: string): Promise<StartedScan> {
    if (await this.viaGcc()) {
      try {
        const r = await this.request<{ audit_report_id?: string; status?: string }>(
          '/api/v1/gcc/audits',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, framework }) },
          this.#authOrigin,
        );
        // Resposta sem id: a análise pode ter sido pedida. Cair no caminho de
        // antes seria pedir duas vezes (e gastar duas cotas).
        if (!r.audit_report_id || !ID_ANALISE.test(r.audit_report_id)) {
          throw new AuditorError('O Guard aceitou o pedido mas não devolveu o número da análise. Confira em Sites no Guard antes de varrer de novo.');
        }
        return {
          job_id: `${GCC_SCAN_PREFIX}${r.audit_report_id}`,
          estimated_duration_seconds: r.status === 'cached' ? 0 : 120,
          link: reportLink(this.#authOrigin, r.audit_report_id),
        };
      } catch (error) {
        if (!(error instanceof AuditorError && error.code && ROTA_AINDA_FECHADA.has(error.code))) throw error;
      }
    }
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

  /** Relatório do gcc (Hguard-2582): status e resultado saem da mesma leitura. */
  async getGccReport(scanId: string): Promise<{ rel: GccRelatorio; link: string }> {
    const id = scanId.slice(GCC_SCAN_PREFIX.length);
    if (!ID_ANALISE.test(id)) throw new AuditorError('scan_id inválido. Use o scan_id devolvido por guard_scan_site.');
    const rel = await this.request<GccRelatorio>(`/api/v1/gcc/audits/${encodeURIComponent(id)}/relatorio`, undefined, this.#authOrigin);
    return { rel, link: reportLink(this.#authOrigin, id) };
  }

  async getStatus(jobId: string): Promise<ScanStatus> {
    if (jobId.startsWith(GCC_SCAN_PREFIX)) {
      const { rel, link } = await this.getGccReport(jobId);
      const status = rel.analise?.status ?? 'queued';
      // O texto de erro do gcc fica de fora: só o código estável vai ao agente.
      return status === 'failed'
        ? { job_id: jobId, status, link, failure: { code: failureCodeOf(rel) } }
        : { job_id: jobId, status, link };
    }
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
    return new AuditorError(parsed.detail ?? 'O Guard bloqueou esta varredura para conexões MCP.', status, parsed.motivo);
  }
  // Hguard-2582: erros do gcc na varredura pelo Guard.
  const gcc = parsed?.type?.startsWith('urn:hoc:error:gcc:') ? parsed.type.slice('urn:hoc:error:gcc:'.length) : undefined;
  if (gcc === 'ownership-not-verified') {
    return new AuditorError('O Guard só analisa domínio verificado desta empresa. Peça para a pessoa verificar a posse do domínio no Guard (em Sites) e varra de novo.', status, gcc);
  }
  if (gcc === 'audit-rate-limit-exceeded') {
    return new AuditorError('A empresa chegou ao limite diário de análises de site. Tente amanhã ou peça a análise na tela do Guard.', status, gcc);
  }
  if (gcc === 'auditor-unavailable') {
    return new AuditorError('O serviço de análise está fora do ar agora. Tente de novo em alguns minutos.', status, gcc);
  }
  if (gcc) return new AuditorError(parsed?.detail ?? `O Guard respondeu ${status}.`, status, gcc);

  // Login expirado/invalido no meio do caminho: mensagem acionavel.
  if (hadBearer && (status === 401 || status === 403)) {
    return new AuditorError('Seu login do Guard expirou ou não vale pra este domínio. Rode guard_login de novo.', status);
  }
  return new AuditorError(extractDetail(body) ?? `Serviço respondeu ${status}`, status);
}
