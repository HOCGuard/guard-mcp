import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { markdownParaDocumento } from '../src/generate/documento.ts';

// Imita as rotas de documento do gcc. Cada teste define `rotas`; tudo o que chega
// fica em `chamadas`.
type Chamada = { method: string; url: string; body: any };
type Rota = (c: Chamada) => { status: number; body?: unknown } | undefined;

let http: Server;
let base: string;
let chamadas: Chamada[] = [];
let rotas: Rota = () => undefined;
let dir: string;
let credPath: string;

before(async () => {
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const chamada: Chamada = { method: req.method ?? 'GET', url: req.url ?? '', body: raw ? JSON.parse(raw) : undefined };
      chamadas.push(chamada);
      const r = rotas(chamada) ?? { status: 404, body: { detail: 'rota não mockada' } };
      res.setHeader('content-type', 'application/json');
      res.writeHead(r.status);
      res.end(r.body === undefined ? '' : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  dir = await mkdtemp(join(tmpdir(), 'hocguard-docs-'));
  credPath = join(dir, 'credentials.json');
});

after(async () => {
  http.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  chamadas = [];
  rotas = () => undefined;
  await writeFile(credPath, JSON.stringify({ access_token: 'jwt', expires_at: Date.now() + 3_600_000, scope: 'gcc:policy:read gcc:policy:write' }));
});

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  const server = createServer({ apiUrl: 'http://127.0.0.1:1', tenant: 'public', requestTimeoutMs: 5000, sdkUrl: 'https://guard.test/sdk/banner.js', serviceToken: undefined, authUrl: base, credentialsPath: credPath });
  await Promise.all([server.connect(b), c.connect(a)]);
  return c;
}
const corpo = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const erro = (r: unknown) => (r as { isError?: boolean }).isError === true;

const DOC = { cod_documento: 'doc-1', tipo: 'privacy', des_status: 'published', des_titulo: 'PP', des_nome: 'PP - HOC Guard', nr_revision: 7, nr_version: 2 };
const VARIAVEIS = { variables: [{ key: 'empresa', label: 'Nome da empresa', value: 'HOC Technology', required: true }, { key: 'email_dpo', label: 'E-mail do encarregado', value: '', required: true }] };
const CHECK = { ready: false, issues: [{ code: 'missing-values', message: 'Faltam dados da empresa', items: ['E-mail do encarregado'] }], checks: [] };

test('markdown vira o documento do editor: seções, lista, negrito, link e dado da empresa', () => {
  const c = markdownParaDocumento('## Quem somos\nA {{empresa}} opera o **HOC Guard**.\n\n- [Política do Google](https://developers.google.com/x)\n- {{outra}}', new Set(['empresa']));
  assert.deepEqual(c.secoes, ['Quem somos']);
  assert.deepEqual(c.variaveisDesconhecidas, ['outra']);
  const [titulo, paragrafo, lista] = c.documento.doc.content;
  assert.deepEqual(titulo, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Quem somos' }] });
  assert.deepEqual(paragrafo!.content, [
    { type: 'text', text: 'A ' },
    { type: 'variable', attrs: { key: 'empresa' } },
    { type: 'text', text: ' opera o ' },
    { type: 'text', text: 'HOC Guard', marks: [{ type: 'bold' }] },
    { type: 'text', text: '.' },
  ]);
  assert.equal(lista!.type, 'bulletList');
  assert.deepEqual((lista!.content![0] as any).content[0].content[0].marks, [{ type: 'link', attrs: { href: 'https://developers.google.com/x' } }]);
});

test('lacuna entre colchetes é achada; link e nota numerada não', () => {
  assert.deepEqual(markdownParaDocumento('CNPJ [CNPJ da empresa]. Veja [aqui](https://x.y) e [1].').lacunas, ['[CNPJ da empresa]']);
});

test('lê o documento com seções, revisão e variáveis', async () => {
  rotas = (c) => (c.url === '/api/v1/gcc/legal-documents/doc-1' ? { status: 200, body: { ...DOC, json_input: markdownParaDocumento('## Quem somos\nx').documento } } : c.url.endsWith('/editor-context') ? { status: 200, body: VARIAVEIS } : undefined);
  const r = await (await client()).callTool({ name: 'guard_get_document', arguments: { document_id: 'doc-1' } });
  const j = JSON.parse(corpo(r));
  assert.equal(j.revisao, 7);
  assert.deepEqual(j.secoes, ['Quem somos']);
  assert.deepEqual(j.variaveis[1], { chave: 'email_dpo', nome: 'E-mail do encarregado', preenchida: false, obrigatoria: true });
  assert.match(j.link, /\/privacidade\/documentos\/doc-1$/);
});

test('escreve o rascunho de um documento existente sobre a revisão lida, sem publicar', async () => {
  rotas = (c) => {
    if (c.method === 'PUT') return { status: 200, body: { ...DOC, nr_revision: 8 } };
    if (c.url.endsWith('/editor-context')) return { status: 200, body: VARIAVEIS };
    if (c.url.endsWith('/review-checklist')) return { status: 200, body: CHECK };
    return undefined;
  };
  const r = await (await client()).callTool({ name: 'guard_write_document_draft', arguments: { document_id: 'doc-1', revision: 7, titulo: 'Política de Privacidade do HOC Guard', markdown: '## Quem somos\nA {{empresa}} opera o HOC Guard. Contato: {{email_dpo}}.' } });
  assert.equal(erro(r), false, corpo(r));
  const put = chamadas.find((c) => c.method === 'PUT')!;
  assert.equal(put.body.expected_revision, 7);
  assert.equal(put.body.json_input.doc.content[1].content[1].type, 'variable');
  assert.equal(chamadas.some((c) => c.url.includes('/publish')), false);
  const j = JSON.parse(corpo(r));
  assert.equal(j.pronto, false);
  assert.deepEqual(j.falta, ['Faltam dados da empresa (E-mail do encarregado)']);
  assert.match(j.aviso, /O agente não publica/);
});

test('cria documento novo do tipo pedido e grava o texto', async () => {
  rotas = (c) => {
    if (c.method === 'POST' && c.url === '/api/v1/gcc/legal-documents') return { status: 201, body: { ...DOC, cod_documento: 'doc-2', des_status: 'draft', nr_revision: 0, nr_version: 0 } };
    if (c.method === 'PUT') return { status: 200, body: { ...DOC, cod_documento: 'doc-2', des_status: 'draft', nr_revision: 1, nr_version: 0 } };
    if (c.url.endsWith('/editor-context')) return { status: 200, body: VARIAVEIS };
    if (c.url.endsWith('/review-checklist')) return { status: 200, body: { ready: true, issues: [], checks: [] } };
    return undefined;
  };
  const r = await (await client()).callTool({ name: 'guard_write_document_draft', arguments: { tipo: 'terms', titulo: 'Termos de Uso', markdown: '## Conta\nGuarde sua senha.' } });
  const j = JSON.parse(corpo(r));
  assert.equal(j.criado, true);
  assert.equal(j.pronto, true);
  assert.deepEqual(chamadas.find((c) => c.method === 'POST')!.body, { tipo: 'terms', des_titulo: 'Termos de Uso' });
  assert.equal(chamadas.find((c) => c.method === 'PUT')!.body.expected_revision, 0);
});

test('texto com lacuna entre colchetes não é gravado nem cria documento', async () => {
  const r = await (await client()).callTool({ name: 'guard_write_document_draft', arguments: { tipo: 'privacy', titulo: 'PP', markdown: '## Quem somos\nInscrita no CNPJ [CNPJ da empresa].' } });
  assert.equal(erro(r), true);
  assert.match(corpo(r), /Nada foi gravado/);
  assert.equal(chamadas.length, 0);
});

test('atualizar sem a revisão lida é recusado antes de chamar o Guard', async () => {
  const r = await (await client()).callTool({ name: 'guard_write_document_draft', arguments: { document_id: 'doc-1', titulo: 'PP', markdown: '## Quem somos\nTexto qualquer aqui.' } });
  assert.equal(erro(r), true);
  assert.equal(chamadas.length, 0);
});

test('conflito de revisão vira instrução para ler de novo', async () => {
  rotas = (c) => (c.method === 'PUT' ? { status: 409, body: { type: 'urn:hoc:error:gcc:document:document-revision-conflict', detail: 'x' } } : c.url.endsWith('/editor-context') ? { status: 200, body: VARIAVEIS } : undefined);
  const r = await (await client()).callTool({ name: 'guard_write_document_draft', arguments: { document_id: 'doc-1', revision: 6, titulo: 'PP', markdown: '## Quem somos\nTexto qualquer aqui.' } });
  assert.equal(erro(r), true);
  assert.match(corpo(r), /guard_get_document/);
});

test('sem a permissão de documentos no login, pede novo login', async () => {
  await writeFile(credPath, JSON.stringify({ access_token: 'jwt', expires_at: Date.now() + 3_600_000, scope: 'scan generate' }));
  const r = await (await client()).callTool({ name: 'guard_list_documents', arguments: {} });
  assert.equal(erro(r), true);
  assert.match(corpo(r), /guard_login/);
  assert.equal(chamadas.length, 0);
});
