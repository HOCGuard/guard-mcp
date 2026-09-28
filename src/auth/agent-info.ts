import { hostname } from 'node:os';

// Identifica o cliente MCP pro backend nomear a sessão de agente (Etapa 1: o
// contrato de sessões de agente). O nome/tipo vêm do `clientInfo` que o
// próprio cliente MCP manda no handshake `initialize` (McpServer expõe via
// `server.server.getClientVersion()`, mesmo acessor já usado em telemetry.ts).

export type AgentClient =
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'github-copilot'
  | 'windsurf'
  | 'gemini-cli'
  | 'outro';

const MAX_AGENT_NAME_LEN = 80;

// Case-insensitive, por inclusão (o contrato não promete um valor exato de
// clientInfo.name, e cada cliente MCP manda o que quiser). Primeira batida
// vence; a ordem só importa se um dia duas agulhas colidirem.
const CLIENT_MATCHERS: ReadonlyArray<{ needle: string; client: AgentClient }> = [
  { needle: 'claude-code', client: 'claude-code' },
  { needle: 'claude code', client: 'claude-code' },
  { needle: 'claude-ai', client: 'claude-desktop' },
  { needle: 'claude desktop', client: 'claude-desktop' },
  { needle: 'cursor', client: 'cursor' },
  { needle: 'visual studio code', client: 'github-copilot' },
  { needle: 'vscode', client: 'github-copilot' },
  { needle: 'windsurf', client: 'windsurf' },
  { needle: 'gemini', client: 'gemini-cli' },
];

export function mapAgentClient(clientInfoName: string | undefined | null): AgentClient {
  const name = (clientInfoName ?? '').toLowerCase();
  if (!name) return 'outro';
  return CLIENT_MATCHERS.find((m) => name.includes(m.needle))?.client ?? 'outro';
}

function shortHostname(host: string): string {
  return host.split('.')[0] || host;
}

const ROTULO: Record<Exclude<AgentClient, 'outro'>, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  'github-copilot': 'GitHub Copilot',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini CLI',
};

// "<nome amigável do cliente MCP> · <hostname curto>", truncado a 80 chars.
// Cliente conhecido usa o rótulo de marca (o clientInfo.name cru costuma vir
// como slug, ex.: "claude-code"); desconhecido usa o nome que ele mandou.
export function buildAgentName(clientInfoName: string | undefined | null, host: string = hostname()): string {
  const client = mapAgentClient(clientInfoName);
  const nome = client !== 'outro' ? ROTULO[client] : (clientInfoName ?? '').trim() || 'Agente MCP';
  const full = `${nome} · ${shortHostname(host)}`;
  return full.length > MAX_AGENT_NAME_LEN ? full.slice(0, MAX_AGENT_NAME_LEN) : full;
}
