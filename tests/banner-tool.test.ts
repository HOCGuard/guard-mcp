import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';

// Imita o contrato do endpoint anônimo (docs de Hguard-1424 no hoc-guard).
let http: Server;
let origin: string;
let criados = 0;
let ultimoBody: Record<string, unknown> = {};
let modo: 'ok' | '404' | '429' = 'ok';

before(async () => {
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method !== 'POST' || req.url !== '/api/v1/public/banner/anonymous') { res.writeHead(404); res.end('{}'); return; }
      if (modo === '404') { res.writeHead(404); res.end('{}'); return; }
      if (modo === '429') { res.writeHead(429); res.end('{}'); return; }
      ultimoBody = JSON.parse(raw) as Record<string, unknown>;
      criados++;
      res.writeHead(201);
      res.end(JSON.stringify({ banner_id: `anon_${criados}`, claim_token: 'SEGREDO-NAO-VAZAR', expires_at: '2026-12-31T00:00:00Z' }));
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;
});
after(() => http.close());

async function client(home: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://x', tenant: 'public', requestTimeoutMs: 1000, sdkUrl: `${origin}/sdk/banner.js`, serviceToken: undefined, homeDir: home });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

test('cria banner com finalidades do projeto e guarda o token só no disco', async () => {
  modo = 'ok';
  const home = await mkdtemp(join(tmpdir(), 'gh-'));
  const c = await client(home);
  const r = await c.callTool({ name: 'guard_create_banner', arguments: {
    site_url: 'meusite.com.br',
    files: [{ path: 'app/layout.tsx', content: "import { GoogleAnalytics } from '@next/third-parties/google';\nconst s = 'https://connect.facebook.net/en_US/fbevents.js';" }],
  } });
  const out = JSON.parse(text(r));
  assert.match(out.banner_id, /^anon_/);
  assert.equal(out.site_origin, 'https://meusite.com.br');
  assert.doesNotMatch(text(r), /SEGREDO-NAO-VAZAR/, 'claim_token não pode voltar ao agente');
  assert.deepEqual((ultimoBody['purposes'] as string[]).sort(), ['analytics', 'marketing', 'necessary']);
  assert.doesNotMatch(JSON.stringify(ultimoBody), /layout\.tsx|import/, 'não envia código nem caminho');
  const file = join(home, '.hocguard', 'banners.json');
  assert.match(await readFile(file, 'utf8'), /SEGREDO-NAO-VAZAR/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('não duplica: mesmo site reaproveita o banner local', async () => {
  modo = 'ok';
  const home = await mkdtemp(join(tmpdir(), 'gh-'));
  const c = await client(home);
  const antes = criados;
  const r1 = JSON.parse(text(await c.callTool({ name: 'guard_create_banner', arguments: { site_url: 'https://loja.com.br/qualquer/rota' } })));
  const r2 = JSON.parse(text(await c.callTool({ name: 'guard_create_banner', arguments: { site_url: 'loja.com.br' } })));
  assert.equal(criados - antes, 1);
  assert.equal(r2.banner_id, r1.banner_id);
  assert.equal(r2.reused, true);
});

test('servidor sem o endpoint (404) dá orientação clara', async () => {
  modo = '404';
  const c = await client(await mkdtemp(join(tmpdir(), 'gh-')));
  const r = await c.callTool({ name: 'guard_create_banner', arguments: { site_url: 'x.com.br' } });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(text(r), /painel/);
});

test('limite (429) vira mensagem legível', async () => {
  modo = '429';
  const c = await client(await mkdtemp(join(tmpdir(), 'gh-')));
  const r = await c.callTool({ name: 'guard_create_banner', arguments: { site_url: 'y.com.br' } });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(text(r), /Limite/);
});

test('recusa http em domínio público', async () => {
  const c = await client(await mkdtemp(join(tmpdir(), 'gh-')));
  const r = await c.callTool({ name: 'guard_create_banner', arguments: { site_url: 'http://inseguro.com.br' } });
  assert.equal((r as { isError?: boolean }).isError, true);
});
