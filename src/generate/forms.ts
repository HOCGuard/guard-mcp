import type { SourceFile } from './trackers.ts';
import { analyzeFormAst, codeOf } from './ast.ts';

// Detecção de formulários que coletam dado pessoal. Heurística estática: acha
// <form> ou campos de entrada de dado pessoal (e-mail, telefone, CPF, nome) e
// checa se já existe algum sinal de consentimento perto (checkbox de aceite,
// menção a política/consentimento). Nada sai da máquina.

export interface DetectedForm {
  path: string;
  /** Campos de dado pessoal reconhecidos (email, telefone, cpf, nome). */
  fields: string[];
  /** true se já há um sinal de consentimento no mesmo arquivo. */
  hasConsent: boolean;
}

const PERSONAL_FIELDS: { field: string; pattern: RegExp }[] = [
  { field: 'email', pattern: /type=["']email["']|name=["'][^"']*e-?mail|\bemail\b/i },
  { field: 'telefone', pattern: /type=["']tel["']|name=["'][^"']*(phone|telefone|celular|whats)/i },
  { field: 'cpf', pattern: /name=["'][^"']*cpf|\bcpf\b|placeholder=["'][^"']*cpf/i },
  { field: 'nome', pattern: /name=["'](nome|name|fullname|full_name)["']|placeholder=["'][^"']*nome/i },
  { field: 'cep', pattern: /name=["'][^"']*cep|\bcep\b/i },
];

const FORM_SIGNAL = /<form\b|useForm\(|react-hook-form|onSubmit=|<Formik\b|handleSubmit/;

// Sinal de que o formulário já pede consentimento: checkbox de aceite, menção a
// política/consentimento/LGPD, ou uso do ponto de coleta do HOC Guard.
const CONSENT_SIGNAL = /type=["']checkbox["'][^>]*(consent|aceit|termos|privac|lgpd)|\b(consentimento|aceito os termos|pol[íi]tica de privacidade|data-hoc-collection-point|CollectionPoint)\b/i;

export function detectForms(files: SourceFile[]): DetectedForm[] {
  const forms: DetectedForm[] = [];
  for (const file of files) {
    // JS/TS: lê os elementos JSX (preciso). Outros formatos: regex sem comentários.
    const ast = analyzeFormAst(file.path, file.content);
    if (ast) {
      if (!ast.hasForm || ast.fields.length === 0) continue;
      forms.push({ path: file.path, fields: ast.fields, hasConsent: ast.hasConsent });
      continue;
    }
    const c = codeOf(file);
    if (!FORM_SIGNAL.test(c)) continue;
    const fields = PERSONAL_FIELDS.filter((f) => f.pattern.test(c)).map((f) => f.field);
    if (fields.length === 0) continue;
    forms.push({ path: file.path, fields, hasConsent: CONSENT_SIGNAL.test(c) });
  }
  return forms;
}
