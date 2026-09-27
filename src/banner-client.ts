import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Cliente do banner anônimo (Hguard-1424, decisão F): cria um banner sem conta,
// reivindicável depois pelo login. O claim_token é o que prova que esta máquina
// criou o banner; ele fica só em ~/.hocguard/banners.json (0600) e nunca volta
// para o agente, para não parar no histórico do chat.

export interface StoredBanner {
  banner_id: string;
  site_origin: string;
  claim_token: string;
  created_at: string;
  expires_at?: string | undefined;
}

export interface CreateBannerInput {
  site_origin: string;
  purposes: string[];
  providers: string[];
  locale: string;
  client_version: string;
}

export interface CreatedBanner {
  banner_id: string;
  claim_token: string;
  expires_at?: string;
}

export class BannerApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BannerApiError';
    this.status = status;
  }
}

export function normalizeOrigin(siteUrl: string): string {
  const withScheme = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;
  const u = new URL(withScheme);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('Use a URL https do site.');
  return u.origin.toLowerCase();
}

export class BannerStore {
  readonly #file: string;
  readonly #dir: string;
  constructor(homeDir: string) {
    this.#dir = join(homeDir, '.hocguard');
    this.#file = join(this.#dir, 'banners.json');
  }
  async all(): Promise<StoredBanner[]> {
    try {
      const data = JSON.parse(await readFile(this.#file, 'utf8')) as unknown;
      return Array.isArray(data) ? (data as StoredBanner[]) : [];
    } catch {
      return [];
    }
  }
  async find(origin: string): Promise<StoredBanner | undefined> {
    return (await this.all()).find((b) => b.site_origin === origin);
  }
  async save(b: StoredBanner): Promise<void> {
    const rest = (await this.all()).filter((x) => x.site_origin !== b.site_origin);
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await writeFile(this.#file, JSON.stringify([...rest, b], null, 2), { mode: 0o600 });
  }
}

export async function createAnonymousBanner(apiOrigin: string, input: CreateBannerInput, timeoutMs = 15_000): Promise<CreatedBanner> {
  let res: Response;
  try {
    res = await fetch(`${apiOrigin}/api/v1/public/banner/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new BannerApiError(`Não foi possível falar com ${apiOrigin}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (res.status === 404) {
    throw new BannerApiError('A criação de banner sem conta ainda não está disponível neste servidor (Hguard-1424). Crie o banner no painel do HOC Guard e passe o banner_id.', 404);
  }
  if (res.status === 429) {
    throw new BannerApiError('Limite de criação de banners atingido. Tente de novo mais tarde ou crie a conta grátis.', 429);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<CreatedBanner> & { detail?: string; error?: string };
  if (!res.ok || typeof body.banner_id !== 'string' || typeof body.claim_token !== 'string') {
    throw new BannerApiError(body.detail ?? body.error ?? `Servidor respondeu ${res.status}`, res.status);
  }
  const out: CreatedBanner = { banner_id: body.banner_id, claim_token: body.claim_token };
  if (typeof body.expires_at === 'string') out.expires_at = body.expires_at;
  return out;
}
