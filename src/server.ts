import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { AuditorClient } from './auditor-client.ts';
import { loadConfig, type Config } from './config.ts';
import { registerScanTools } from './tools/scan.ts';
import { registerGenerateTools } from './tools/generate.ts';
import { registerConsentTools } from './tools/consent.ts';
import { registerAdvancedTools } from './tools/advanced.ts';
import { instrumentTools, telemetryHome } from './telemetry.ts';
import { registerPrompts } from './tools/prompts.ts';
import { registerBannerTools } from './tools/banner.ts';

export const SERVER_NAME = 'hoc-guard';
// src/ e dist/ ficam um nível abaixo da raiz do pacote.
export const SERVER_VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  instrumentTools(server, {
    enabled: config.telemetry === true,
    url: config.telemetryUrl ?? `${new URL(config.sdkUrl).origin}/api/v1/public/mcp/telemetry`,
    version: SERVER_VERSION,
    homeDir: config.homeDir ?? telemetryHome(),
  });
  registerScanTools(server, new AuditorClient(config));
  registerGenerateTools(server, config.sdkUrl);
  registerConsentTools(server);
  registerAdvancedTools(server, config.sdkUrl);
  registerBannerTools(server, { apiOrigin: new URL(config.sdkUrl).origin, homeDir: config.homeDir ?? telemetryHome(), version: SERVER_VERSION });
  registerPrompts(server);
  return server;
}
