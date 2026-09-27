import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';

// Telemetria de uso, OPT-IN (GUARD_TELEMETRY=1). Um produto de privacidade não
// pode ligar para casa escondido, então:
// - desligada por padrão;
// - nunca envia código, caminho, URL varrida, nome de projeto ou dado pessoal;
// - só envia campos de uma lista fechada (ferramenta, versão, resultado,
//   duração, modo, framework, contagens, nome do agente);
// - id de instalação aleatório, sem ligação com pessoa;
// - fire-and-forget: timeout curto e qualquer erro é engolido.

export interface TelemetryConfig {
  enabled: boolean;
  url: string;
  version: string;
  homeDir: string;
}

export interface TelemetryEvent {
  v: 1;
  install_id: string;
  version: string;
  client: string;
  tool: string;
  outcome: 'ok' | 'error';
  duration_ms: number;
  mode?: string;
  framework?: string;
  findings?: number;
  score?: number;
}

type Sender = (url: string, event: TelemetryEvent) => Promise<void>;

const defaultSender: Sender = async (url, event) => {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(1500),
  });
};

async function installId(homeDir: string): Promise<string> {
  const dir = join(homeDir, '.hocguard');
  const file = join(dir, 'install-id');
  try {
    const id = (await readFile(file, 'utf8')).trim();
    if (/^[0-9a-f-]{36}$/.test(id)) return id;
  } catch { /* primeira execução */ }
  const id = randomUUID();
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(file, id, { mode: 0o600 });
  } catch { /* sem disco gravável: id efêmero */ }
  return id;
}

// Lê só campos numéricos/enumerados do resultado. Nada de texto livre.
function summarize(result: unknown): Pick<TelemetryEvent, 'mode' | 'framework' | 'findings' | 'score'> & { isError: boolean } {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined;
  const out: Pick<TelemetryEvent, 'mode' | 'framework' | 'findings' | 'score'> & { isError: boolean } = { isError: r?.isError === true };
  const text = r?.content?.[0]?.text;
  if (!text || out.isError) return out;
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const banner = p['banner'] as Record<string, unknown> | undefined;
    const mode = (p['mode'] ?? banner?.['mode']) as unknown;
    if (typeof mode === 'string' && /^[a-z-]{1,24}$/.test(mode)) out.mode = mode;
    if (typeof p['framework'] === 'string' && /^[a-z]{1,12}$/.test(p['framework'])) out.framework = p['framework'];
    const findings = Array.isArray(p['findings']) ? p['findings'].length : typeof p['total'] === 'number' ? p['total'] : undefined;
    if (typeof findings === 'number') out.findings = Math.min(findings, 99);
    const score = p['score'] ?? p['score_antes'];
    if (typeof score === 'number') out.score = Math.max(0, Math.min(100, Math.round(score)));
  } catch { /* resposta não-JSON */ }
  return out;
}

function clientName(server: McpServer): string {
  const raw = server.server.getClientVersion()?.name ?? 'unknown';
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'unknown';
}

// Envolve registerTool para medir toda ferramenta registrada depois desta chamada.
export function instrumentTools(server: McpServer, config: TelemetryConfig, send: Sender = defaultSender): void {
  if (!config.enabled) return;
  const idPromise = installId(config.homeDir);
  const original = server.registerTool.bind(server) as unknown as (name: string, cfg: unknown, cb: (...a: unknown[]) => unknown) => unknown;

  (server as unknown as { registerTool: typeof original }).registerTool = (name, cfg, cb) =>
    original(name, cfg, async (...args: unknown[]) => {
      const t0 = performance.now();
      let result: unknown;
      let threw = false;
      try {
        result = await cb(...args);
        return result;
      } catch (error) {
        threw = true;
        throw error;
      } finally {
        const s = summarize(result);
        const event: TelemetryEvent = {
          v: 1,
          install_id: await idPromise,
          version: config.version,
          client: clientName(server),
          tool: name,
          outcome: threw || s.isError ? 'error' : 'ok',
          duration_ms: Math.round(performance.now() - t0),
        };
        if (s.mode) event.mode = s.mode;
        if (s.framework) event.framework = s.framework;
        if (s.findings !== undefined) event.findings = s.findings;
        if (s.score !== undefined) event.score = s.score;
        void send(config.url, event).catch(() => {});
      }
    });
}

export function telemetryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['GUARD_HOME'] ?? homedir();
}
