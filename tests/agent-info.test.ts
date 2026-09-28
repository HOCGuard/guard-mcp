import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAgentClient, buildAgentName } from '../src/auth/agent-info.ts';

// --- mapAgentClient -----------------------------------------------------------

test('mapAgentClient reconhece cada cliente do contrato, case-insensitive e por inclusão', () => {
  assert.equal(mapAgentClient('claude-code'), 'claude-code');
  assert.equal(mapAgentClient('Claude-Code/1.2.3'), 'claude-code');
  assert.equal(mapAgentClient('CLAUDE-CODE'), 'claude-code');

  assert.equal(mapAgentClient('claude-ai'), 'claude-desktop');
  assert.equal(mapAgentClient('Claude Desktop'), 'claude-desktop');
  assert.equal(mapAgentClient('claude desktop (mac)'), 'claude-desktop');

  assert.equal(mapAgentClient('cursor'), 'cursor');
  assert.equal(mapAgentClient('Cursor/0.9'), 'cursor');

  assert.equal(mapAgentClient('Visual Studio Code'), 'github-copilot');
  assert.equal(mapAgentClient('vscode'), 'github-copilot');
  assert.equal(mapAgentClient('VSCode-Copilot'), 'github-copilot');

  assert.equal(mapAgentClient('windsurf'), 'windsurf');
  assert.equal(mapAgentClient('Windsurf/1.0'), 'windsurf');

  assert.equal(mapAgentClient('gemini-cli'), 'gemini-cli');
  assert.equal(mapAgentClient('Gemini-CLI'), 'gemini-cli');
});

test('mapAgentClient devolve "outro" pro que não reconhece, vazio ou ausente', () => {
  assert.equal(mapAgentClient('algum-cliente-novo'), 'outro');
  assert.equal(mapAgentClient(''), 'outro');
  assert.equal(mapAgentClient(undefined), 'outro');
  assert.equal(mapAgentClient(null), 'outro');
});

// --- buildAgentName -------------------------------------------------------------

test('buildAgentName junta o nome do cliente com o hostname curto', () => {
  assert.equal(buildAgentName('Claude Code', 'minha-maquina.local'), 'Claude Code · minha-maquina');
  assert.equal(buildAgentName('Cursor', 'host-sem-dominio'), 'Cursor · host-sem-dominio');
});

test('buildAgentName usa default quando não há clientInfo.name', () => {
  assert.equal(buildAgentName(undefined, 'host'), 'Agente MCP · host');
  assert.equal(buildAgentName('   ', 'host'), 'Agente MCP · host');
});

test('buildAgentName nunca passa de 80 caracteres', () => {
  const nome = 'Um Cliente MCP Com Nome Gigante Que Ninguém Deveria Usar De Verdade Mas Pode Acontecer';
  const out = buildAgentName(nome, 'maquina-com-nome-tambem-gigante-so-pra-garantir');
  assert.ok(out.length <= 80, `esperava <=80, veio ${out.length}`);
});

test('buildAgentName usa o rótulo de marca quando o cliente manda slug', () => {
  assert.equal(buildAgentName('claude-code', 'mac.local'), 'Claude Code · mac');
  assert.equal(buildAgentName('Meu Agente', 'mac'), 'Meu Agente · mac');
});
