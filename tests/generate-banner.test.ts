import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { detectRouter, detectTrackers } from '../src/generate/trackers.ts';

const LAYOUT = `import Script from 'next/script';
export default function RootLayout({ children }) {
  return (<html><head>
    <Script src="https://www.googletagmanager.com/gtag/js?id=G-X" />
    <script dangerouslySetInnerHTML={{ __html: "fbq('init', '123')" }} />
  </head><body>{children}</body></html>);
}`;

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://x', tenant: 'public', requestTimeoutMs: 1000, sdkUrl: 'https://guard.test/sdk/banner.js' });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}

function payload(result: unknown) {
  return JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as Record<string, any>;
}

test('detecta Google Analytics e Meta Pixel com suas finalidades', () => {
  const found = detectTrackers([{ path: 'app/layout.tsx', content: LAYOUT }]);
  assert.deepEqual(found.map((t) => [t.id, t.purpose]).sort(), [
    ['google-analytics', 'analytics'],
    ['meta-pixel', 'marketing'],
  ]);
});

test('reconhece App Router e Pages Router', () => {
  assert.equal(detectRouter([{ path: 'src/app/layout.tsx', content: '' }]), 'app');
  assert.equal(detectRouter([{ path: 'pages/_app.js', content: '' }]), 'pages');
  assert.equal(detectRouter([{ path: 'index.html', content: '' }]), 'unknown');
});

test('gera integração a partir de conteúdo inline', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_generate_cookie_banner',
    arguments: { files: [{ path: 'app/layout.tsx', content: LAYOUT }], banner_id: 'bn_1' },
  }));
  assert.equal(out['mode'], 'consent-gate');
  assert.equal(out['router'], 'app');
  assert.deepEqual(out['purposes'], ['necessary', 'analytics', 'marketing']);
  const layout = out['changes'].find((f: any) => f.path === 'app/layout.tsx' && f.code.includes('banner.js'));
  assert.match(layout.code, /data-banner-id="bn_1"/);
  // Hguard-2581: como no guia do Guard, <script> comum como primeiro filho de
  // <head>, com bloqueio prévio; nunca <Script> de next/script.
  assert.match(layout.code, /<head>\s*\{\/\*[^*]*\*\/\}\s*<script\s/);
  assert.match(layout.code, /data-autoblock="1"/);
  assert.doesNotMatch(layout.code, /next\/script|beforeInteractive|async/);
  assert.ok(out['changes'].some((f: any) => f.code.includes('data-purpose="marketing"')));
  assert.deepEqual(out['warnings'], []);
  assert.ok(out['cautions'].some((c: string) => /nonce/.test(c) && /guard\.test/.test(c)));
  assert.ok(out['cautions'].some((c: string) => /data-hoc-src/.test(c) && /data-hoc-cat/.test(c)));
  assert.ok(out['verify'].some((v: string) => /window\.HOCGuard\.getConsent\(\)/.test(v) && /hoc_guard_bn_1/.test(v)));
});

test('Hguard-2581: Pages Router põe o banner como primeiro filho de <Head>, não no <body>', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_generate_cookie_banner',
    arguments: { files: [{ path: 'pages/_app.tsx', content: "export default function App(){ return <script dangerouslySetInnerHTML={{ __html: \"fbq('init','1')\" }} /> }" }], banner_id: 'bn_2' },
  }));
  const doc = out['changes'].find((f: any) => f.path === 'pages/_document.tsx');
  assert.ok(doc, 'sem _document');
  assert.match(doc.code, /<Head>\s*\{\/\*[^*]*\*\/\}\s*<script\s/);
  assert.ok(doc.code.indexOf('banner.js') < doc.code.indexOf('<body>'));
  assert.doesNotMatch(doc.code, /next\/script/);
  await c.close();
});

test('Hguard-2581: instalação antiga com <Script> de next/script vira aviso e troca', async () => {
  const antigo = `import Script from 'next/script';
export default function RootLayout({ children }) {
  return (<html><body>{children}
    <Script src="https://guard.hoc.app.br/sdk/banner.js" data-banner-id="bn_9" strategy="beforeInteractive" />
  </body></html>);
}`;
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { files: [{ path: 'app/layout.tsx', content: antigo }], banner_id: 'bn_9' } }));
  assert.equal(out['mode'], 'already-installed');
  assert.ok(out['warnings'].some((w: string) => /next\/script/.test(w)));
  assert.ok(out['changes'].some((f: any) => f.path === 'app/layout.tsx' && /data-autoblock="1"/.test(f.code)));
  await c.close();
});

test('Hguard-2581: instalação correta já existente não gera troca', async () => {
  const certo = `export default function RootLayout({ children }) {
  return (<html><head><script src="https://guard.hoc.app.br/sdk/banner.js" data-banner-id="bn_8" data-autoblock="1"></script></head><body>{children}</body></html>);
}`;
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { files: [{ path: 'app/layout.tsx', content: certo }] } }));
  assert.equal(out['mode'], 'already-installed');
  assert.deepEqual(out['changes'], []);
  await c.close();
});

test('lê o projeto do disco ignorando node_modules; sem tracker gera aviso informativo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guard-'));
  await mkdir(join(root, 'app'));
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(root, 'app', 'layout.tsx'), 'export default function L(){}');
  await writeFile(join(root, 'node_modules', 'x', 'i.js'), "fbq('init','1')");
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { project_path: root } }));
  assert.deepEqual(out['trackers'], []);
  assert.equal(out['mode'], 'notice');
  const aviso = out['changes'].find((f: any) => f.path === 'components/CookieNotice.tsx');
  assert.ok(aviso, 'deve gerar o componente de aviso');
  assert.match(aviso.code, /Política de Privacidade/);
  // não é parede de consentimento, então não pede banner_id.
  assert.ok(!out['warnings'].some((w: string) => w.includes('SEU_BANNER_ID')));
});

test('exige project_path ou files', async () => {
  const c = await client();
  const res = await c.callTool({ name: 'guard_generate_cookie_banner', arguments: {} });
  assert.equal((res as any).isError, true);
});
