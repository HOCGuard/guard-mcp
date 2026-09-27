import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { SECURE_SHIP_STEPS } from '../src/workflow.ts';

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://x', tenant: 'public', requestTimeoutMs: 1000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

test('prompt guard-secure-ship aparece e traz o roteiro com o projeto', async () => {
  const c = await client();
  const { prompts } = await c.listPrompts();
  assert.ok(prompts.some((p) => p.name === 'guard-secure-ship'));
  const r = await c.getPrompt({ name: 'guard-secure-ship', arguments: { project_path: '/app' } });
  const text = (r.messages[0]!.content as { text: string }).text;
  assert.match(text, /guard_check_compliance/);
  assert.match(text, /guard_make_compliant/);
  assert.match(text, /Projeto: \/app/);
});

test('SKILL.md está em sincronia com src/workflow.ts', async () => {
  const skill = await readFile(new URL('../skills/guard-secure-ship/SKILL.md', import.meta.url), 'utf8');
  assert.ok(skill.includes(SECURE_SHIP_STEPS.trim()), 'regenere a SKILL.md a partir de src/workflow.ts');
});

test('roteiro cita só ferramentas que existem', async () => {
  const c = await client();
  const { tools } = await c.listTools();
  const nomes = new Set(tools.map((t) => t.name));
  for (const citada of SECURE_SHIP_STEPS.match(/guard_[a-z_]+/g) ?? []) assert.ok(nomes.has(citada), `ferramenta inexistente no roteiro: ${citada}`);
});
