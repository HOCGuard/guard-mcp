import { McpServer } from '@modelcontextprotocol/server';
import { AuditorClient } from './auditor-client.ts';
import { loadConfig, type Config } from './config.ts';
import { registerScanTools } from './tools/scan.ts';
import { registerGenerateTools } from './tools/generate.ts';

export const SERVER_NAME = 'hoc-guard';
export const SERVER_VERSION = '0.0.1';

export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerScanTools(server, new AuditorClient(config));
  registerGenerateTools(server, config.sdkUrl);
  return server;
}
