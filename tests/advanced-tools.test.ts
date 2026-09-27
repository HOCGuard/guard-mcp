import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';

const APP = `import { GoogleAnalytics } from '@next/third-parties/google';
export function Contato() {
  return (<form onSubmit={handleSubmit}>
    <input type="email" name="email" />
    <button>Enviar</button>
  </form>);
}
const fontes = 'https://fonts.googleapis.com/css2?family=Inter';
const pagamento = fetch('https://api.stripe.com/v1/checkout');`;

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

test('guard_check_compliance detecta transferência internacional', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { files: [{ path: 'app/layout.tsx', content: APP }] } }));
  assert.ok(out['findings'].some((f: any) => f.code === 'transferencia-internacional'));
  assert.match(out['report_markdown'], /Relatório de conformidade/);
});

test('guard_generate_policy descreve rastreadores, campos e terceiros reais', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_policy', arguments: { files: [{ path: 'app/p.tsx', content: APP }], dpo_email: 'dpo@x.com' } }));
  const md = out['policy_markdown'];
  assert.match(md, /Google Analytics/);
  assert.match(md, /email/);
  assert.match(md, /Stripe|Google Fonts/);
  assert.match(md, /dpo@x\.com/);
});

test('guard_explain devolve explicação de um código e lista quando vazio', async () => {
  const c = await client();
  const um = payload(await c.callTool({ name: 'guard_explain', arguments: { finding_code: 'tracker-sem-consentimento' } }));
  assert.match(um['base'], /LGPD/);
  const lista = payload(await c.callTool({ name: 'guard_explain', arguments: {} }));
  assert.ok(Array.isArray(lista['codes']) && lista['codes'].includes('transferencia-internacional'));
});

test('guard_make_compliant devolve checklist, banner, consentimento e política', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_make_compliant', arguments: { files: [{ path: 'app/layout.tsx', content: APP }], banner_id: 'bn_1' } }));
  assert.ok(out['score_antes'] < 100);
  // depois honesto: banner e consentimento resolvidos, política e transferência pendentes.
  assert.ok(out['score_depois_estimado'] > out['score_antes']);
  assert.ok(out['score_depois_estimado'] < 100);
  assert.ok(out['resolvido_ao_aplicar'].includes('tracker-sem-consentimento'));
  assert.ok(out['ainda_pendente'].some((p: any) => p.code === 'transferencia-internacional'));
  assert.equal(out['banner']['mode'], 'consent-gate');
  assert.ok(out['consent_points']['changes'].some((f: any) => f.path === 'components/ConsentField.tsx'));
  assert.match(out['policy']['policy_markdown'], /Política de Privacidade/);
});

test('multiframework: Vite gera integração genérica por script, não Next', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { files: [
    { path: 'package.json', content: '{ "dependencies": { "vite": "^5", "react": "^18" } }' },
    { path: 'src/main.tsx', content: "import ReactGA from 'react-ga4'; ReactGA.initialize('G-X');" },
  ] } }));
  assert.equal(out['framework'], 'vite');
  assert.ok(out['changes'].some((f: any) => /index\.html/.test(f.path)));
});

test('idempotência: não gera de novo se banner.js já existe', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_cookie_banner', arguments: { files: [
    { path: 'app/layout.tsx', content: '<Script src="https://x/sdk/banner.js" data-banner-id="bn_1" />' },
  ] } }));
  assert.equal(out['mode'], 'already-installed');
  assert.deepEqual(out['changes'], []);
});

test('check devolve método, confiança e evidência', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { files: [
    { path: 'app/layout.tsx', content: "import { GoogleAnalytics } from '@next/third-parties/google';" },
  ] } }));
  assert.match(out['metodo'], /estática/);
  const tracker = out['findings'].find((f: any) => f.code === 'tracker-sem-consentimento');
  assert.equal(tracker.confidence, 'media');
  assert.match(tracker.evidence, /app\/layout\.tsx:\d+/);
});

test('relatório estático nunca diz "conforme"', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { files: [{ path: 'app/page.tsx', content: 'export default function P(){ return null; }' }] } }));
  assert.doesNotMatch(out['report_markdown'], /Conforme/);
  assert.match(out['report_markdown'], /guard_scan_site/);
});

test('política traz cabeçalho de rascunho', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_generate_policy', arguments: { files: [{ path: 'app/p.tsx', content: '<input type="email" />' }] } }));
  assert.match(out['policy_markdown'], /RASCUNHO/);
});

test('AST: rastreador citado só em comentário não vira achado', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { files: [
    { path: 'app/page.tsx', content: "// TODO: talvez usar googletagmanager.com/gtag/js no futuro\n/* fbq('init') */\nexport default function P(){ return null; }" },
  ] } }));
  assert.deepEqual(out['findings'], []);
});

test('AST: "email" em variável não é formulário; input type=email dentro de form é', async () => {
  const c = await client();
  const semForm = payload(await c.callTool({ name: 'guard_add_consent_point', arguments: { files: [
    { path: 'lib/mail.ts', content: "export function enviar(email: string) { return email.trim(); }" },
  ] } }));
  assert.deepEqual(semForm['forms'], []);
  const comForm = payload(await c.callTool({ name: 'guard_add_consent_point', arguments: { files: [
    { path: 'app/c.tsx', content: 'export const C = () => <form onSubmit={x}><input type="email" name="contato" /></form>;' },
  ] } }));
  assert.deepEqual(comForm['forms'][0].fields, ['email']);
});

test('AST: URL com // não é tratada como comentário', async () => {
  const c = await client();
  const out = payload(await c.callTool({ name: 'guard_check_compliance', arguments: { files: [
    { path: 'app/layout.tsx', content: 'export const s = <script src="https://connect.facebook.net/en_US/fbevents.js" />;' },
  ] } }));
  assert.ok(out['findings'].some((f: any) => f.code === 'tracker-sem-consentimento'));
});
