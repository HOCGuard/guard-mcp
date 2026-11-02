import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { AuditorClient } from './auditor-client.ts';
import { createTokenProvider } from './auth/session.ts';
import { loadConfig, type Config } from './config.ts';
import { registerScanTools } from './tools/scan.ts';
import { registerGenerateTools } from './tools/generate.ts';
import { registerConsentTools } from './tools/consent.ts';
import { registerAdvancedTools } from './tools/advanced.ts';
import { instrumentTools, telemetryHome } from './telemetry.ts';
import { registerPrompts } from './tools/prompts.ts';
import { registerBannerTools } from './tools/banner.ts';
import { registerAuthTools } from './tools/auth.ts';
import { registerPurposeTools } from './tools/purposes.ts';
import { registerDocumentTools } from './tools/documents.ts';

export const SERVER_NAME = 'hoc-guard';
// src/ e dist/ ficam um nível abaixo da raiz do pacote.
export const SERVER_VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

// Hguard-2583: roteiro curto para o agente escolher a ferramenta certa sem
// ler as 22 descrições. Vale para todo cliente que repassa instructions.
export const SERVER_INSTRUCTIONS = [
  'HOC Guard: privacidade e LGPD de dentro do agente.',
  '- Site no ar: guard_scan_site, depois guard_get_scan_status a cada 15 s, depois guard_get_scan_results. Leia verdict antes da nota e repasse verdict_note. Se o status vier failed, ele já traz o motivo e o próximo passo. Com login, a análise entra em Sites no Guard: mande o link.',
  '- Projeto local: guard_check_compliance ou guard_make_compliant para banner e consentimento; guard_generate_cookie_banner ou guard_create_banner para instalar o banner. O código não sai da máquina.',
  '- Conta do Guard (exige guard_login e guard_login_check): finalidades (guard_*_purpose) e documentos (guard_*_document*). Tudo vira rascunho; quem publica é a pessoa, na tela do Guard, pelo link que a ferramenta devolve.',
  '- Conceito ou artigo da LGPD: guard_explain. Não invente artigo, resolução nem prazo.',
].join('\n');

export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  instrumentTools(server, {
    enabled: config.telemetry === true,
    url: config.telemetryUrl ?? `${new URL(config.sdkUrl).origin}/api/v1/public/mcp/telemetry`,
    version: SERVER_VERSION,
    homeDir: config.homeDir ?? telemetryHome(),
  });
  // Um TokenProvider por processo, compartilhado pelos clientes HTTP que
  // exigem login: garante que a renovação do refresh_token (rotação +
  // concorrência) tenha um lock só, e não um por cliente.
  const tokens = createTokenProvider(config);
  registerAuthTools(server, config);
  registerScanTools(server, new AuditorClient(config, tokens));
  registerGenerateTools(server, config.sdkUrl);
  registerConsentTools(server);
  registerAdvancedTools(server, config.sdkUrl);
  registerBannerTools(server, { apiOrigin: new URL(config.sdkUrl).origin, homeDir: config.homeDir ?? telemetryHome(), version: SERVER_VERSION });
  registerPurposeTools(server, config, tokens);
  registerDocumentTools(server, config, tokens);
  registerPrompts(server);
  return server;
}
