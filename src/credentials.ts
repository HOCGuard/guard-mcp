import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import type { Config } from './config.ts';

// Credencial do Device Flow guardada localmente. Nunca vai pro repositório nem
// pra log. Diretório 0700, arquivo 0600.
export interface StoredCredentials {
  access_token: string;
  /** epoch ms de expiração (Date.now() + expires_in * 1000 no momento do login). */
  expires_at: number;
  scope: string;
}

// Margem de seguranca: considera o token "morto" 30s antes da expiracao real,
// pra nao mandar um token que expira no meio do request.
const SKEW_MS = 30_000;

export function resolveCredentialsPath(config: Config): string {
  if (config.credentialsPath) return config.credentialsPath;
  const base = config.homeDir ?? homedir();
  return join(base, '.hocguard', 'credentials.json');
}

export async function loadCredentials(path: string): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (typeof parsed.access_token !== 'string' || typeof parsed.expires_at !== 'number') {
      return null;
    }
    return { access_token: parsed.access_token, expires_at: parsed.expires_at, scope: parsed.scope ?? '' };
  } catch {
    // Arquivo ausente ou corrompido: trata como "nao logado", nao como erro.
    return null;
  }
}

export async function saveCredentials(path: string, cred: StoredCredentials): Promise<void> {
  const dir = join(path, '..');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cred, null, 2), { mode: 0o600 });
}

export async function deleteCredentials(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

// Devolve o access_token se ainda válido (com margem), senão null.
export function activeToken(cred: StoredCredentials | null, nowMs: number = Date.now()): string | null {
  if (!cred) return null;
  if (cred.expires_at - SKEW_MS <= nowMs) return null;
  return cred.access_token;
}

// Login pendente entre guard_login (inicia) e guard_login_check (confirma). Fica
// ao lado da credencial, mesmo diretório 0700 / arquivo 0600.
export interface PendingLogin {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  interval: number;
  /** epoch ms em que o device_code expira. */
  expires_at: number;
}

export function resolvePendingPath(config: Config): string {
  return join(dirname(resolveCredentialsPath(config)), 'pending-login.json');
}

export async function loadPendingLogin(path: string): Promise<PendingLogin | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PendingLogin>;
    if (typeof parsed.device_code !== 'string' || typeof parsed.expires_at !== 'number') return null;
    return {
      device_code: parsed.device_code,
      user_code: parsed.user_code ?? '',
      verification_uri_complete: parsed.verification_uri_complete ?? '',
      interval: parsed.interval ?? 5,
      expires_at: parsed.expires_at,
    };
  } catch {
    return null;
  }
}

export async function savePendingLogin(path: string, pending: PendingLogin): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(pending, null, 2), { mode: 0o600 });
}

export async function deletePendingLogin(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ausente: nada a fazer
  }
}
