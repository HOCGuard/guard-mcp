import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';

// Projetos em disco que imitam apps reais (cenário 4): pegam o que string
// inline não pega, como comentário com nome de tracker e "email" em variável.
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://x', tenant: 'public', requestTimeoutMs: 1000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}
function payload(result: unknown) {
  return JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as Record<string, any>;
}

test('next-saas: acha GA, Meta Pixel, formulário e terceiros; ignora Hotjar comentado', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { project_path: fixture('next-saas') } }));
  const codes = out['findings'].map((f: any) => f.code).sort();
  assert.deepEqual(codes, ['form-sem-consentimento', 'sem-link-politica', 'tracker-sem-consentimento', 'transferencia-internacional']);
  const tracker = out['findings'].find((f: any) => f.code === 'tracker-sem-consentimento');
  assert.match(tracker.detail, /Google Analytics/);
  assert.match(tracker.detail, /Meta Pixel/);
  assert.doesNotMatch(tracker.detail, /Hotjar/, 'Hotjar só aparece em comentário');
  const transf = out['findings'].find((f: any) => f.code === 'transferencia-internacional');
  assert.match(transf.detail, /Stripe/);
  assert.match(transf.detail, /Google Fonts/);
});

test('next-saas: make_compliant gera consent-gate, ConsentField e política coerente', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_make_compliant', arguments: { project_path: fixture('next-saas'), banner_id: 'bn_1' } }));
  assert.equal(out['banner']['mode'], 'consent-gate');
  assert.ok(out['consent_points']['changes'].some((f: any) => f.path === 'app/contato/page.tsx'));
  const md = out['policy']['policy_markdown'];
  for (const campo of ['email', 'telefone', 'nome']) assert.match(md, new RegExp(campo));
  assert.ok(out['score_depois_estimado'] > out['score_antes']);
});

test('next-limpo: sem tracker nem formulário, gera aviso e não acusa nada', async () => {
  const c = await client();
  const check = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { project_path: fixture('next-limpo') } }));
  assert.deepEqual(check['findings'], []);
  const banner = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { project_path: fixture('next-limpo') } }));
  assert.equal(banner['mode'], 'notice');
  assert.equal(banner['framework'], 'nextjs');
});

test('vite-landing: detecta Vite, GTM e RD Station no index.html', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { project_path: fixture('vite-landing') } }));
  assert.equal(out['framework'], 'vite');
  const provs = out['trackers'].map((t: any) => t.provider);
  assert.ok(provs.includes('Google Tag Manager'));
  assert.ok(provs.includes('RD Station'));
  assert.ok(out['changes'].some((f: any) => /index\.html/.test(f.path)));
});
