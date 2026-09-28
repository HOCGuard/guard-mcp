import type { Config } from '../config.ts';
import { DEFAULT_AUTH_URL } from '../config.ts';
import {
  resolveCredentialsPath,
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  activeToken,
  type StoredCredentials,
} from '../credentials.ts';
import { refreshAccessToken, DeviceFlowError, GUARD_MCP_CLIENT_ID } from './device-flow.ts';

type FetchImpl = typeof fetch;

// Único ponto de obtenção do access_token pros clientes HTTP (PurposesClient,
// AuditorClient). Resolve dois problemas do contrato de sessões de agente:
//
// 1. Renovação: se o access_token guardado expirou (ou está perto disso) mas
//    existe refresh_token, renova sozinho antes de devolver o token.
// 2. Concorrência: o refresh tem rotação com reuse detection no servidor —
//    usar o MESMO refresh_token em duas chamadas simultâneas revoga a sessão
//    inteira. `inFlight` garante que N chamadas concorrentes esperem UMA
//    renovação só, em vez de cada uma tentar a sua.
//
// Um TokenProvider é criado uma vez por processo (em createServer) e
// compartilhado entre todos os clientes HTTP, pra o lock valer de verdade.
export interface TokenProvider {
  /** Token pronto pra usar AGORA: renova se o guardado expirou. null = nunca logou, ou a sessão morreu (ver invalid_grant abaixo). */
  currentToken(): Promise<string | null>;
  /** Força uma renovação (usa o mesmo lock de currentToken). Chame depois de um 401 da API pra tentar de novo uma única vez. */
  forceRefresh(): Promise<string | null>;
}

export function createTokenProvider(config: Config, opts: { fetchImpl?: FetchImpl } = {}): TokenProvider {
  const authUrl = config.authUrl ?? DEFAULT_AUTH_URL;
  const credPath = resolveCredentialsPath(config);
  const fetchImpl = opts.fetchImpl;

  let inFlight: Promise<string | null> | null = null;

  async function doRefresh(): Promise<string | null> {
    const cred = await loadCredentials(credPath);
    if (!cred?.refresh_token) return null;
    try {
      const refreshed = await refreshAccessToken(
        authUrl,
        { clientId: GUARD_MCP_CLIENT_ID, refreshToken: cred.refresh_token },
        fetchImpl ? { fetchImpl } : {},
      );
      const next: StoredCredentials = {
        access_token: refreshed.access_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
        scope: refreshed.scope,
      };
      // Rotação: o servidor deve mandar um refresh_token novo a cada renovação.
      // Se por algum motivo não mandar, mantém o antigo em vez de perder a sessão.
      next.refresh_token = refreshed.refresh_token ?? cred.refresh_token;
      await saveCredentials(credPath, next);
      return next.access_token;
    } catch (error) {
      if (error instanceof DeviceFlowError && error.code === 'invalid_grant') {
        // Sessão morta (revogada, expirada no servidor, ou reuse detection
        // pegou um refresh_token repetido): não adianta insistir, limpa e o
        // próximo currentToken() volta "não logado".
        await deleteCredentials(credPath);
      }
      // Qualquer outro erro (rede, servidor fora) é transitório: mantém a
      // credencial em disco pra uma próxima tentativa poder funcionar.
      return null;
    }
  }

  function refreshOnce(): Promise<string | null> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    async currentToken() {
      const cred = await loadCredentials(credPath);
      if (!cred) return null;
      const token = activeToken(cred);
      if (token) return token;
      if (!cred.refresh_token) return null; // credencial antiga (sem refresh) e expirada: precisa de guard_login
      return refreshOnce();
    },
    forceRefresh() {
      return refreshOnce();
    },
  };
}
