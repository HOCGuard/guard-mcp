import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { instrumentTools, type TelemetryEvent } from '../src/telemetry.ts';
import { loadConfig } from '../src/config.ts';

async function setup(enabled: boolean) {
  const home = await mkdtemp(join(tmpdir(), 'guard-home-'));
  const sent: TelemetryEvent[] = [];
  const server = new McpServer({ name: 't', version: '0' });
  instrumentTools(server, { enabled, url: 'https://t.test/x', version: '9.9.9', homeDir: home }, async (_u, e) => { sent.push(e); });
  server.registerTool('ferramenta', { inputSchema: z.object({ project_path: z.string() }) }, async ({ project_path }) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ mode: 'consent-gate', framework: 'nextjs', score: 65, findings: [{}, {}], segredo: project_path }) }],
  }));
  server.registerTool('quebra', { inputSchema: z.object({}) }, async () => { throw new Error('boom'); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'Claude Code', version: '1.0.0' });
  await Promise.all([server.connect(b), c.connect(a)]);
  return { c, sent, home };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test('desligada por padrão: loadConfig sem GUARD_TELEMETRY não liga', () => {
  assert.equal(loadConfig({}).telemetry, false);
  assert.equal(loadConfig({ GUARD_TELEMETRY: '1' }).telemetry, true);
});

test('desligada: nenhuma chamada gera envio', async () => {
  const { c, sent } = await setup(false);
  await c.callTool({ name: 'ferramenta', arguments: { project_path: '/Users/fulano/cliente-secreto' } });
  await tick();
  assert.equal(sent.length, 0);
});

test('ligada: envia só a lista fechada de campos, nunca caminho ou texto livre', async () => {
  const { c, sent } = await setup(true);
  await c.callTool({ name: 'ferramenta', arguments: { project_path: '/Users/fulano/cliente-secreto' } });
  await tick();
  assert.equal(sent.length, 1);
  const e = sent[0]!;
  assert.deepEqual(Object.keys(e).sort(), ['client', 'duration_ms', 'findings', 'framework', 'install_id', 'mode', 'outcome', 'score', 'tool', 'v', 'version'].sort());
  assert.equal(e.tool, 'ferramenta');
  assert.equal(e.outcome, 'ok');
  assert.equal(e.client, 'claude-code');
  assert.equal(e.mode, 'consent-gate');
  assert.equal(e.findings, 2);
  assert.equal(e.score, 65);
  assert.doesNotMatch(JSON.stringify(e), /fulano|cliente-secreto|segredo/);
});

test('erro na ferramenta vira outcome=error e o erro continua chegando ao cliente', async () => {
  const { c, sent } = await setup(true);
  const res = await c.callTool({ name: 'quebra', arguments: {} });
  await tick();
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(sent[0]!.outcome, 'error');
});

test('install_id é aleatório, persistido com permissão 0600 e reusado', async () => {
  const { c, sent, home } = await setup(true);
  await c.callTool({ name: 'ferramenta', arguments: { project_path: 'x' } });
  await c.callTool({ name: 'ferramenta', arguments: { project_path: 'y' } });
  await tick();
  const file = join(home, '.hocguard', 'install-id');
  const id = (await readFile(file, 'utf8')).trim();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(sent[0]!.install_id, id);
  assert.equal(sent[1]!.install_id, id);
});

test('falha no envio nunca afeta a ferramenta', async () => {
  const home = await mkdtemp(join(tmpdir(), 'guard-home-'));
  const server = new McpServer({ name: 't', version: '0' });
  instrumentTools(server, { enabled: true, url: 'https://t.test/x', version: '1', homeDir: home }, async () => { throw new Error('rede caiu'); });
  server.registerTool('ok', { inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text' as const, text: '{}' }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'x', version: '1' });
  await Promise.all([server.connect(b), c.connect(a)]);
  const res = await c.callTool({ name: 'ok', arguments: {} });
  assert.notEqual((res as { isError?: boolean }).isError, true);
});
