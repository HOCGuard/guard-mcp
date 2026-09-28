import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.ts';
import { DEFAULT_AUTH_URL } from '../config.ts';
import { PURPOSES_LOGIN_SCOPE } from '../purposes-client.ts';
import {
  resolveCredentialsPath,
  resolvePendingPath,
  saveCredentials,
  deleteCredentials,
  savePendingLogin,
  loadPendingLogin,
  deletePendingLogin,
} from '../credentials.ts';
import {
  requestDeviceCode,
  pollOnce,
  decodeJwtSubject,
  DeviceFlowError,
  GUARD_MCP_CLIENT_ID,
} from '../auth/device-flow.ts';

function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}

function failure(error: unknown) {
  const message = error instanceof DeviceFlowError ? error.message : `Falha inesperada: ${String(error)}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

export function registerAuthTools(server: McpServer, config: Config): void {
  const authUrl = config.authUrl ?? DEFAULT_AUTH_URL;
  const credPath = resolveCredentialsPath(config);
  const pendingPath = resolvePendingPath(config);

  server.registerTool(
    'guard_login',
    {
      description:
        'Começa o login no HOC Guard, no estilo npm login/gh auth login. Devolve na hora um link e um código curto: mostre ao usuário, peça pra abrir o link e autorizar no navegador. Depois que ele autorizar, chame guard_login_check para concluir. Rode uma vez por máquina; depois guard_scan_site, os geradores e as ferramentas de finalidades usam o login sozinhos.',
      inputSchema: z.object({
        scope: z
          .string()
          .default(PURPOSES_LOGIN_SCOPE)
          .describe(`Permissões pedidas. Padrão: "${PURPOSES_LOGIN_SCOPE}" (varrer, gerar e consultar/editar finalidades; o token só recebe o que o papel da conta permite).`),
      }),
      annotations: {
        title: 'Entrar no HOC Guard (passo 1)',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ scope }) => {
      try {
        const device = await requestDeviceCode(authUrl, { clientId: GUARD_MCP_CLIENT_ID, scope });
        await savePendingLogin(pendingPath, {
          device_code: device.device_code,
          user_code: device.user_code,
          verification_uri_complete: device.verification_uri_complete,
          interval: device.interval,
          expires_at: Date.now() + device.expires_in * 1000,
        });
        return text(
          `Abra ${device.verification_uri_complete} e confirme o código ${device.user_code}. ` +
            `Assim que autorizar no navegador, rode guard_login_check para concluir. ` +
            `O código vale por ${Math.round(device.expires_in / 60)} minutos.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_login_check',
    {
      description:
        'Conclui o login iniciado por guard_login: verifica se você já autorizou no navegador. Se sim, salva a credencial e responde "Conectado". Se ainda não, avisa e você roda de novo depois de autorizar.',
      inputSchema: z.object({}),
      annotations: {
        title: 'Concluir login no HOC Guard (passo 2)',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      const pending = await loadPendingLogin(pendingPath);
      if (!pending) {
        return text('Nenhum login em andamento. Rode guard_login primeiro.');
      }
      if (pending.expires_at <= Date.now()) {
        await deletePendingLogin(pendingPath);
        return text('O código expirou. Rode guard_login de novo.');
      }
      try {
        const result = await pollOnce(authUrl, { clientId: GUARD_MCP_CLIENT_ID, deviceCode: pending.device_code });
        switch (result.kind) {
          case 'token': {
            await saveCredentials(credPath, {
              access_token: result.token.access_token,
              expires_at: Date.now() + result.token.expires_in * 1000,
              scope: result.token.scope,
            });
            await deletePendingLogin(pendingPath);
            const sub = decodeJwtSubject(result.token.access_token);
            return text(
              `Conectado${sub ? ` como ${sub}` : ''}. O Guard já pode varrer e gerar em nome da sua conta. Pra sair, use guard_logout.`,
            );
          }
          case 'pending':
          case 'slow_down':
            return text(
              `Ainda não vi a autorização. Abra ${pending.verification_uri_complete}, confirme o código ${pending.user_code} e rode guard_login_check de novo.`,
            );
          case 'expired':
            await deletePendingLogin(pendingPath);
            return text('O código expirou. Rode guard_login de novo.');
          case 'denied':
            await deletePendingLogin(pendingPath);
            return text('A autorização foi negada no navegador. Rode guard_login se quiser tentar de novo.');
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_logout',
    {
      description: 'Encerra o login local do Guard: apaga a credencial guardada em ~/.hocguard. Depois disso, varrer volta a exigir guard_login.',
      inputSchema: z.object({}),
      annotations: {
        title: 'Sair do HOC Guard',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const apagou = await deleteCredentials(credPath);
      await deletePendingLogin(pendingPath);
      return text(apagou ? 'Sessão encerrada. Sua credencial local foi apagada.' : 'Você não estava logado.');
    },
  );
}
