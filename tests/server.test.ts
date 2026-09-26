import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer, SERVER_NAME } from '../src/server.ts';

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test('o servidor completa o handshake e se identifica', async () => {
  const client = await connectedClient();
  assert.equal(client.getServerVersion()?.name, SERVER_NAME);
  await client.close();
});

test('tools/list responde sem erro', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  assert.ok(Array.isArray(tools));
  await client.close();
});
