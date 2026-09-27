import { parse } from '@babel/parser';

// Análise por AST para tirar os falsos positivos do regex (cenário 3):
// - comentários saem com precisão, sem confundir o "//" de uma URL;
// - campos de formulário vêm dos atributos JSX, não de qualquer "email" solto.
// Quando o arquivo não é JS/TS ou não parseia, quem chama cai no regex.

const JS_FILE = /\.(m?[jt]sx?|cjs)$/;

type Node = { type: string; start?: number | null; end?: number | null; [k: string]: unknown };

function parseFile(path: string, content: string): { program: Node; comments: Node[] } | null {
  if (!JS_FILE.test(path)) return null;
  try {
    const ast = parse(content, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'importAttributes'],
    }) as unknown as { program: Node; comments?: Node[] };
    return { program: ast.program, comments: ast.comments ?? [] };
  } catch {
    return null;
  }
}

// Troca cada comentário por espaços (mantendo as quebras de linha), para que os
// números de linha da evidência continuem certos.
export function stripComments(path: string, content: string): string {
  const parsed = parseFile(path, content);
  if (!parsed) return stripCommentsFallback(path, content);
  let out = content;
  for (const c of [...parsed.comments].sort((a, b) => (b.start ?? 0) - (a.start ?? 0))) {
    const s = c.start ?? 0;
    const e = c.end ?? s;
    out = out.slice(0, s) + out.slice(s, e).replace(/[^\n]/g, ' ') + out.slice(e);
  }
  return out;
}

// HTML/Vue/Svelte/Astro: remove <!-- --> e comentários de bloco; linhas "//"
// só quando começam a linha (evita cortar URL).
function stripCommentsFallback(path: string, content: string): string {
  if (/\.json$/.test(path)) return content;
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return content
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  const n = node as Node;
  if (typeof n.type === 'string') visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    walk(n[key], visit);
  }
}

function jsxName(n: Node): string {
  const name = n['name'] as Node | undefined;
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return String(name['name']);
  if (name.type === 'JSXMemberExpression') return String((name['property'] as Node)['name']);
  return '';
}

function attrValue(attr: Node): string {
  const v = attr['value'] as Node | null | undefined;
  if (!v) return 'true';
  if (v.type === 'StringLiteral') return String(v['value']);
  if (v.type === 'JSXExpressionContainer') {
    const e = v['expression'] as Node;
    if (e.type === 'StringLiteral') return String(e['value']);
    if (e.type === 'TemplateLiteral') return ((e['quasis'] as Node[]) ?? []).map((q) => String((q['value'] as { raw: string }).raw)).join('');
  }
  return '';
}

const INPUT_TAGS = /^(input|textarea|select|Input|TextField|TextInput|Textarea|FormField|Field)$/;
const FIELD_RULES: { field: string; test: (a: Record<string, string>) => boolean }[] = [
  { field: 'email', test: (a) => a['type'] === 'email' || /e-?mail/i.test(a['name'] ?? '') || /e-?mail/i.test(a['autoComplete'] ?? a['autocomplete'] ?? '') },
  { field: 'telefone', test: (a) => a['type'] === 'tel' || /(phone|telefone|celular|whats)/i.test(a['name'] ?? '') },
  { field: 'cpf', test: (a) => /cpf/i.test(a['name'] ?? '') || /cpf/i.test(a['placeholder'] ?? '') },
  { field: 'nome', test: (a) => /^(nome|name|fullname|full_name|nome_completo)$/i.test(a['name'] ?? '') || /^nome/i.test(a['placeholder'] ?? '') || /^name$/i.test(a['autoComplete'] ?? '') },
  { field: 'cep', test: (a) => /cep|postal/i.test(a['name'] ?? '') },
];

export interface AstForm {
  hasForm: boolean;
  fields: string[];
  hasConsent: boolean;
}

// Lê campos e consentimento a partir dos elementos JSX. null quando o arquivo
// não é JS/TS parseável (quem chama usa o regex).
export function analyzeFormAst(path: string, content: string): AstForm | null {
  const parsed = parseFile(path, content);
  if (!parsed) return null;
  let hasForm = false;
  let hasConsent = false;
  const fields = new Set<string>();

  walk(parsed.program, (n) => {
    if (n.type === 'JSXOpeningElement') {
      const tag = jsxName(n);
      if (tag === 'form' || tag === 'Form' || tag === 'Formik') hasForm = true;
      const attrs: Record<string, string> = {};
      for (const a of (n['attributes'] as Node[]) ?? []) {
        if (a.type !== 'JSXAttribute') continue;
        const key = String((a['name'] as Node)['name']);
        attrs[key] = attrValue(a);
        if (key === 'onSubmit') hasForm = true;
        if (key === 'data-hoc-collection-point') hasConsent = true;
      }
      if (tag === 'ConsentField' || tag === 'CollectionPoint') hasConsent = true;
      if (INPUT_TAGS.test(tag)) {
        if (attrs['type'] === 'checkbox' && /(consent|aceit|termos|privac|lgpd)/i.test(`${attrs['name'] ?? ''} ${attrs['id'] ?? ''}`)) hasConsent = true;
        for (const r of FIELD_RULES) if (r.test(attrs)) fields.add(r.field);
      }
    }
    if (n.type === 'CallExpression') {
      const callee = n['callee'] as Node;
      if (callee.type === 'Identifier' && (callee['name'] === 'useForm' || callee['name'] === 'handleSubmit')) hasForm = true;
    }
    if (n.type === 'JSXText' && /(consentimento|aceito os termos|pol[íi]tica de privacidade)/i.test(String(n['value']))) hasConsent = true;
  });

  return { hasForm, fields: [...fields], hasConsent };
}

// Conteúdo sem comentários, com cache (vários detectores leem o mesmo arquivo).
const cache = new Map<string, string>();
export function codeOf(file: { path: string; content: string }): string {
  const key = `${file.path}\u0000${file.content}`;
  let out = cache.get(key);
  if (out === undefined) {
    out = stripComments(file.path, file.content);
    if (cache.size > 5000) cache.clear();
    cache.set(key, out);
  }
  return out;
}
