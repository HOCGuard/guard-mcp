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
// usa fonts.googleapis.com e api.stripe.com`;

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
