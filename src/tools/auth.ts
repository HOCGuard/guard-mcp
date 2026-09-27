import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.ts';
import { DEFAULT_AUTH_URL } from '../config.ts';
import { resolveCredentialsPath, saveCredentials, deleteCredentials } from '../credentials.ts';
import {
  requestDeviceCode,
  pollForToken,
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

  server.registerTool(
    'guard_login',
    {
      description:
        'Conecta você ao HOC Guard pra varrer e gerar como você mesmo, sem colar token. Igual ao login do npm ou do gh: devolve um link e um código curto, você abre no navegador e autoriza, e o Guard passa a agir em nome da sua conta (inclusive usando os domínios que você já verificou). Rode uma vez por máquina; depois guard_scan_site e os geradores usam esse login sozinhos.',
      inputSchema: z.object({
        scope: z
          .string()
          .default('scan generate')
          .describe('Permissões pedidas. Padrão: "scan generate".'),
      }),
      annotations: {
        title: 'Entrar no HOC Guard',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ scope }) => {
      try {
        const device = await requestDeviceCode(authUrl, { clientId: GUARD_MCP_CLIENT_ID, scope });

        // Mostra o link e o código assim que o fluxo começa (o retorno da tool só
        // sai depois da aprovação). Best-effort: se o cliente não exibe logging,
        // seguimos mesmo assim.
        const aviso = `Abra ${device.verification_uri_complete} e confirme o código ${device.user_code}. Estou aguardando você autorizar no navegador...`;
        try {
          await server.sendLoggingMessage({ level: 'info', data: aviso });
        } catch {
          // cliente sem logging: sem problema
        }

        const token = await pollForToken(
          authUrl,
          {
            clientId: GUARD_MCP_CLIENT_ID,
            deviceCode: device.device_code,
            interval: device.interval,
            expiresIn: device.expires_in,
          },
        );

        await saveCredentials(credPath, {
          access_token: token.access_token,
          expires_at: Date.now() + token.expires_in * 1000,
          scope: token.scope,
        });

        const sub = decodeJwtSubject(token.access_token);
        return text(
          `Conectado${sub ? ` como ${sub}` : ''}. O Guard já pode varrer e gerar em nome da sua conta. Pra sair, use guard_logout.`,
        );
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
      return text(apagou ? 'Sessão encerrada. Sua credencial local foi apagada.' : 'Você não estava logado.');
    },
  );
}
