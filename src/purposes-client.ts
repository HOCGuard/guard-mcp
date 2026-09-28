import type { Config } from './config.ts';
import { DEFAULT_AUTH_URL } from './config.ts';
import { resolveCredentialsPath, loadCredentials, activeToken } from './credentials.ts';

// Cliente das finalidades do gcc na conta do usuário. Usa o Bearer do login
// (guard_login) contra a mesma origem do issuer. Nunca publica: publicar é
// ação humana na tela do Guard (o gcc recusa com publish-human-only).

export const PURPOSES_READ_SCOPE = 'gcc:purposes:read';
export const PURPOSES_WRITE_SCOPE = 'gcc:purposes:write';
export const PURPOSES_LOGIN_SCOPE = `scan generate ${PURPOSES_READ_SCOPE} ${PURPOSES_WRITE_SCOPE}`;

export type LegalBasis = 'consent' | 'legitimate_interest' | 'contract' | 'legal_obligation';

export interface PurposeSummary {
  published_version?: number | null;
  published_legal_basis?: string | null;
  published_at?: string | null;
  draft_version_id?: string | null;
  draft_legal_basis?: string | null;
  draft_created_at?: string | null;
  draft_proposta?: { agente?: string; resumo?: string } | null;
}

export interface PurposeListItem {
  id: string;
  name: string;
  description?: string | null;
  summary?: PurposeSummary | null;
}

export interface Lia {
  interest?: string;
  necessity?: string;
  balance?: string;
  safeguards?: string;
  opt_out?: string;
  conclusion?: string;
}

export interface StudioContext {
  law?: string;
  basis?: string;
  scope?: string;
  rationale?: string;
  retention?: number | string | null;
  starts?: string;
  points?: unknown;
  sensitive?: boolean;
  minors?: boolean;
  lia?: Lia;
  [key: string]: unknown;
}

export interface PurposeStudio {
  title?: string;
  description?: string;
  text?: string;
  identifier?: string;
  contexts?: StudioContext[];
  [key: string]: unknown;
}

export interface PurposeVersion {
  id: string;
  version_number?: number;
  status: 'draft' | 'published' | 'superseded';
  legal_basis?: string | null;
  retention_days?: number | null;
  grouping_identifier?: string | null;
  consent_text?: string | null;
  config?: { purpose_studio?: PurposeStudio; proposta?: unknown; [key: string]: unknown } | null;
  published_at?: string | null;
}

export class PurposesError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'PurposesError';
    this.status = status;
    this.code = code;
  }
}

export function loginHint(): string {
  return `Rode guard_login com scope "${PURPOSES_LOGIN_SCOPE}", autorize no navegador e conclua com guard_login_check.`;
}

export class PurposesClient {
  readonly origin: string;
  readonly #credentialsPath: string;
  readonly #timeoutMs: number;

  constructor(config: Config) {
    this.origin = new URL(config.authUrl ?? DEFAULT_AUTH_URL).origin;
    this.#credentialsPath = resolveCredentialsPath(config);
    this.#timeoutMs = config.requestTimeoutMs;
  }

  reviewLink(purposeId: string): string {
    return `${this.origin}/privacidade/finalidades/${encodeURIComponent(purposeId)}`;
  }

  // Token lido a cada chamada, pra pegar um guard_login feito no mesmo processo.
  // Se o token declara scopes e falta o necessário, recusa antes de chamar a API.
  private async bearer(scope: string): Promise<string> {
    const cred = await loadCredentials(this.#credentialsPath);
    const token = activeToken(cred);
    if (!cred || !token) {
      throw new PurposesError(`Você não está conectado ao HOC Guard (ou o login expirou). ${loginHint()}`, 401);
    }
    const granted = cred.scope.split(/\s+/).filter(Boolean);
    if (granted.length > 0 && !granted.includes(scope)) {
      throw new PurposesError(missingScopeMessage(scope), 403, 'missing-scope');
    }
    return token;
  }

  private async request<T>(scope: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await this.bearer(scope);
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw new PurposesError(
        `Não foi possível falar com o HOC Guard em ${this.origin}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const text = await response.text();
    if (!response.ok) throw httpError(response.status, text, scope);
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  async list(params: { page: number; per_page: number; search?: string | undefined }): Promise<{ data: PurposeListItem[]; meta?: Record<string, unknown> }> {
    const qs = new URLSearchParams({ page: String(params.page), per_page: String(params.per_page) });
    if (params.search) qs.set('search', params.search);
    return this.request(PURPOSES_READ_SCOPE, `/api/v1/gcc/purposes?${qs}`);
  }

  async get(id: string): Promise<PurposeListItem & Record<string, unknown>> {
    const res = await this.request<{ data: PurposeListItem & Record<string, unknown> }>(PURPOSES_READ_SCOPE, `/api/v1/gcc/purposes/${encodeURIComponent(id)}`);
    return res.data;
  }

  async versions(id: string): Promise<PurposeVersion[]> {
    const res = await this.request<{ data: PurposeVersion[] }>(PURPOSES_READ_SCOPE, `/api/v1/gcc/purposes/${encodeURIComponent(id)}/versions`);
    return res.data ?? [];
  }

  async createAssisted(body: Record<string, unknown>): Promise<{ id: string; name: string; draft_version_id: string }> {
    const res = await this.request<{ data: { id: string; name: string; draft_version_id: string } }>(
      PURPOSES_WRITE_SCOPE,
      '/api/v1/gcc/purposes/assisted',
      { method: 'POST', body },
    );
    return res.data;
  }

  async duplicate(versionId: string): Promise<Partial<PurposeVersion> & { id: string }> {
    const res = await this.request<{ data: Partial<PurposeVersion> & { id: string } }>(
      PURPOSES_WRITE_SCOPE,
      `/api/v1/gcc/purpose-versions/${encodeURIComponent(versionId)}/duplicate`,
      { method: 'POST', body: {} },
    );
    return res.data;
  }

  async patchVersion(versionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(PURPOSES_WRITE_SCOPE, `/api/v1/gcc/purpose-versions/${encodeURIComponent(versionId)}`, { method: 'PATCH', body });
  }

  async deleteVersion(versionId: string): Promise<{ purpose_removida?: boolean }> {
    const res = await this.request<{ data?: { purpose_removida?: boolean } }>(
      PURPOSES_WRITE_SCOPE,
      `/api/v1/gcc/purpose-versions/${encodeURIComponent(versionId)}`,
      { method: 'DELETE' },
    );
    return res.data ?? {};
  }
}

function missingScopeMessage(scope: string): string {
  return scope === PURPOSES_WRITE_SCOPE
    ? `Seu login não permite editar finalidades. Se você entrou antes desta versão, ${loginHint()} Se já fez isso, o papel da sua conta no Guard não permite editar finalidades: peça a um administrador.`
    : `Seu login não permite consultar finalidades. Se você entrou antes desta versão, ${loginHint()} Se já fez isso, o papel da sua conta no Guard não dá acesso às finalidades: peça a um administrador.`;
}

// Erros RFC 7807 com type = urn:hoc:error:<...>:<code>. `code` fica só com o
// último segmento (ex: purpose-has-other-draft) para as ferramentas compararem.
function httpError(status: number, body: string, scope: string): PurposesError {
  let parsed: { type?: string; code?: string; error?: string; detail?: string; message?: string; title?: string } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // corpo não JSON: fica só o status
  }
  const raw = [parsed.type, parsed.code, parsed.error].find((v) => typeof v === 'string' && v.includes(':')) ?? parsed.code ?? parsed.type;
  const code = raw?.split(':').pop();
  const detail = parsed.detail ?? parsed.message ?? parsed.title ?? (parsed.error && !parsed.error.includes(':') ? parsed.error : undefined);

  if (status === 401) {
    return new PurposesError(`Seu login do Guard expirou ou foi revogado. ${loginHint()}`, status, code);
  }
  if (code === 'oauth-client-route-not-allowed' || code === 'agent-route-not-allowed') {
    return new PurposesError(
      'O Guard não libera essa ação para agentes de IA: pelo MCP só dá para consultar finalidades e propor rascunhos. Peça para a pessoa fazer isso na tela do Guard.',
      status,
      code,
    );
  }
  if (code === 'publish-human-only') {
    return new PurposesError('A liberação é feita por uma pessoa na tela do Guard. O agente só propõe rascunhos.', status, code);
  }
  if (code === 'purpose-version-not-own-proposal') {
    return new PurposesError(
      'Esse rascunho não é proposta sua (foi aberto na tela, por outra pessoa ou por outro agente). O agente só edita ou cancela a própria proposta.',
      status,
      code,
    );
  }
  if (status === 403) {
    return new PurposesError(missingScopeMessage(scope), status, code);
  }
  if (status === 404) {
    return new PurposesError('Finalidade ou versão não encontrada nesta conta. Confira o id com guard_list_purposes.', status, code);
  }
  if (code === 'legitimate-interest-sensitive-data') {
    return new PurposesError(
      'O Guard recusou: legítimo interesse não pode ser usado com dado pessoal sensível (LGPD art. 11). Use consentimento como base legal.',
      status,
      code,
    );
  }
  if (code === 'purpose-version-not-draft') {
    return new PurposesError('Essa versão já foi liberada: não é mais rascunho e não pode ser cancelada pelo agente.', status, code);
  }
  return new PurposesError(detail ? `O Guard recusou (${status}): ${detail}` : `O Guard respondeu ${status}.`, status, code);
}
