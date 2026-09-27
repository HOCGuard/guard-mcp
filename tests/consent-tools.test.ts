import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';

const FORM_SEM_CONSENTIMENTO = `export function Contato() {
  return (<form onSubmit={handleSubmit}>
    <input type="email" name="email" />
    <input type="tel" name="telefone" />
    <button>Enviar</button>
  </form>);
}`;

const FORM_COM_CONSENTIMENTO = `export function Contato() {
  return (<form onSubmit={handleSubmit}>
    <input type="email" name="email" />
    <label><input type="checkbox" name="consent" /> Aceito a política de privacidade</label>
    <button>Enviar</button>
  </form>);
}`;

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

test('guard_add_consent_point: gera ConsentField para formulário sem consentimento', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_add_consent_point',
    arguments: { files: [{ path: 'app/contato.tsx', content: FORM_SEM_CONSENTIMENTO }] },
  }));
  assert.equal(out['forms'][0].hasConsent, false);
  assert.deepEqual(out['forms'][0].fields.sort(), ['email', 'telefone']);
  assert.ok(out['changes'].some((f: any) => f.path === 'components/ConsentField.tsx'));
  assert.ok(out['changes'].some((f: any) => f.path === 'app/contato.tsx' && f.code.includes('ConsentField')));
});

test('guard_add_consent_point: não mexe em formulário que já tem consentimento', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_add_consent_point',
    arguments: { files: [{ path: 'app/contato.tsx', content: FORM_COM_CONSENTIMENTO }] },
  }));
  assert.equal(out['forms'][0].hasConsent, true);
  assert.deepEqual(out['changes'], []);
});

test('guard_check_compliance: acha tracker e formulário sem consentimento e baixa a nota', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_check_compliance',
    arguments: { files: [
      { path: 'app/layout.tsx', content: "import { GoogleAnalytics } from '@next/third-parties'; <GoogleAnalytics gaId='G-X' />" },
      { path: 'app/contato.tsx', content: FORM_SEM_CONSENTIMENTO },
    ] },
  }));
  const codes = out['findings'].map((f: any) => f.code);
  assert.ok(codes.includes('tracker-sem-consentimento'));
  assert.ok(codes.includes('form-sem-consentimento'));
  assert.ok(codes.includes('sem-link-politica'));
  assert.ok(out['score'] < 100);
});

test('guard_check_compliance: projeto limpo tira nota alta', async () => {
  const c = await client();
  const out = payload(await c.callTool({
    name: 'guard_check_compliance',
    arguments: { files: [{ path: 'app/page.tsx', content: 'export default function P(){ return <h1>Oi</h1>; }' }] },
  }));
  assert.deepEqual(out['findings'], []);
  assert.equal(out['score'], 100);
});
