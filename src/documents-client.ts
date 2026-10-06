import type { Config } from './config.ts';
import { DEFAULT_AUTH_URL } from './config.ts';
import { resolveCredentialsPath, loadCredentials } from './credentials.ts';
import { createTokenProvider, type TokenProvider } from './auth/session.ts';
import type { DocumentoDoEditor } from './generate/documento.ts';

// Documentos jurídicos do gcc na conta do usuário (política de privacidade,
// termos, cookies...). O agente lê e escreve o RASCUNHO; publicar é sempre de uma
// pessoa na tela (o gcc recusa com publish-human-only). Mesmo Bearer do login.

export const DOCUMENTS_READ_SCOPE = 'gcc:policy:read';
export const DOCUMENTS_WRITE_SCOPE = 'gcc:policy:write';

export const DOCUMENT_TYPES = ['privacy', 'terms', 'cookies', 'subprocessadores', 'terceiros', 'custom'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface LegalDocument {
  cod_documento?: string;
  cod_document?: string;
  tipo: string;
  des_status: 'draft' | 'published' | 'archived';
  des_titulo: string | null;
  des_nome: string | null;
  des_slug?: string | null;
  nr_revision?: number;
  nr_version?: number;
  json_input?: DocumentoDoEditor;
}

export interface DocumentVariable {
  key: string;
  label: string;
  value: string;
  required: boolean;
}

export interface ReviewChecklist {
  ready: boolean;
  issues: Array<{ code: string; message: string; items?: string[] }>;
  checks: Array<{ id: string; ok: boolean; code: string | null; items: string[] }>;
}

export class DocumentsError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'DocumentsError';
    this.status = status;
    this.code = code;
  }
}

const LOGIN = `Rode guard_login (o padrão já pede "${DOCUMENTS_READ_SCOPE} ${DOCUMENTS_WRITE_SCOPE}"), autorize no navegador e conclua com guard_login_check.`;

export const idDe = (d: LegalDocument): string => d.cod_documento ?? d.cod_document ?? '';

export class DocumentsClient {
  readonly origin: string;
  readonly #credentialsPath: string;
  readonly #timeoutMs: number;
  readonly #tokens: TokenProvider;

  constructor(config: Config, tokens?: TokenProvider) {
    this.origin = new URL(config.authUrl ?? DEFAULT_AUTH_URL).origin;
    this.#credentialsPath = resolveCredentialsPath(config);
    this.#timeoutMs = config.requestTimeoutMs;
    this.#tokens = tokens ?? createTokenProvider(config);
  }

  /** Tela do documento no Guard: situação, revisão e o botão de publicar. */
  link(id: string): string {
    return `${this.origin}/privacidade/documentos/${encodeURIComponent(id)}`;
  }

  private async bearer(scope: string): Promise<string> {
    const token = await this.#tokens.currentToken();
    if (!token) throw new DocumentsError(`Você não está conectado ao HOC Guard (ou o login expirou). ${LOGIN}`, 401);
    const granted = ((await loadCredentials(this.#credentialsPath))?.scope ?? '').split(/\s+/).filter(Boolean);
    if (granted.length > 0 && !granted.includes(scope)) throw new DocumentsError(semPermissao(scope), 403, 'missing-scope');
    return token;
  }

  private async doFetch(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<Response> {
    try {
      return await fetch(`${this.origin}${path}`, {
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
      throw new DocumentsError(`Não foi possível falar com o HOC Guard em ${this.origin}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  private async request<T>(scope: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let token = await this.bearer(scope);
    let response = await this.doFetch(path, token, init);
    if (response.status === 401) {
      const renewed = await this.#tokens.forceRefresh();
      if (renewed) {
        token = renewed;
        response = await this.doFetch(path, token, init);
      }
    }
    const text = await response.text();
    if (!response.ok) throw erroHttp(response.status, text, scope);
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  async list(tipo?: string): Promise<LegalDocument[]> {
    const qs = tipo ? `?${new URLSearchParams({ tipo })}` : '';
    const res = await this.request<{ documents?: LegalDocument[] }>(DOCUMENTS_READ_SCOPE, `/api/v1/gcc/legal-documents${qs}`);
    return res.documents ?? [];
  }

  get(id: string): Promise<LegalDocument> {
    return this.request(DOCUMENTS_READ_SCOPE, `/api/v1/gcc/legal-documents/${encodeURIComponent(id)}`);
  }

  async variables(id: string): Promise<DocumentVariable[]> {
    const res = await this.request<{ variables?: DocumentVariable[]; data?: { variables?: DocumentVariable[] } }>(
      DOCUMENTS_READ_SCOPE,
      `/api/v1/gcc/legal-documents/${encodeURIComponent(id)}/editor-context`,
    );
    return res.variables ?? res.data?.variables ?? [];
  }

  checklist(id: string): Promise<ReviewChecklist> {
    return this.request(DOCUMENTS_READ_SCOPE, `/api/v1/gcc/legal-documents/${encodeURIComponent(id)}/review-checklist`);
  }

  create(tipo: DocumentType, titulo: string, nome?: string): Promise<LegalDocument> {
    return this.request(DOCUMENTS_WRITE_SCOPE, '/api/v1/gcc/legal-documents', {
      method: 'POST',
      body: { tipo, des_titulo: titulo, ...(nome ? { des_nome: nome } : {}) },
    });
  }

  saveDraft(id: string, body: { json_input: DocumentoDoEditor; des_titulo?: string; des_nome?: string; expected_revision: number }): Promise<LegalDocument> {
    return this.request(DOCUMENTS_WRITE_SCOPE, `/api/v1/gcc/legal-documents/${encodeURIComponent(id)}`, { method: 'PUT', body });
  }
}

function semPermissao(scope: string): string {
  const acao = scope === DOCUMENTS_WRITE_SCOPE ? 'escrever rascunhos de documentos' : 'consultar documentos';
  return `Seu login não permite ${acao}. Se você entrou antes desta versão, ${LOGIN} Se já fez isso, o papel da sua conta no Guard não permite: peça a um administrador.`;
}

function erroHttp(status: number, body: string, scope: string): DocumentsError {
  let p: { type?: string; detail?: string; title?: string; motivo?: string } = {};
  try {
    p = JSON.parse(body) as typeof p;
  } catch {
    // corpo não JSON: fica só o status
  }
  if (p.type === 'urn:hoc:error:agent:blocked') return new DocumentsError(p.detail ?? 'O Guard bloqueou esta ação para conexões MCP.', status, p.motivo);
  const code = p.type?.split(':').pop();
  if (status === 401) return new DocumentsError(`Seu login do Guard expirou ou foi revogado. ${LOGIN}`, status, code);
  if (code === 'publish-human-only') return new DocumentsError('A publicação é feita por uma pessoa na tela do Guard. O agente só escreve o rascunho.', status, code);
  if (code === 'agent-route-not-allowed' || code === 'agent-field-not-allowed' || code === 'agent-type-not-allowed') {
    return new DocumentsError(p.detail ?? 'O Guard não libera essa ação para conexões MCP.', status, code);
  }
  if (code === 'document-revision-conflict' || status === 409) {
    return new DocumentsError('Alguém mudou o documento depois que você leu. Leia de novo com guard_get_document e escreva sobre a versão nova.', status, code);
  }
  if (status === 403) return new DocumentsError(p.detail ?? semPermissao(scope), status, code);
  if (status === 404) return new DocumentsError('Documento não encontrado nesta conta. Confira o id com guard_list_documents.', status, code);
  return new DocumentsError(p.detail ?? p.title ?? `O Guard respondeu ${status}.`, status, code);
}
