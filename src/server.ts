import { McpServer } from '@modelcontextprotocol/server';

export const SERVER_NAME = 'hoc-guard';
export const SERVER_VERSION = '0.0.1';

export function createServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
}
