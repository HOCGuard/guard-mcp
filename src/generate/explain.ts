// Explicações em português claro para cada tipo de achado do diagnóstico.
// Transforma o MCP de ferramenta em professor: por que é problema, o que a lei
// diz, e como corrigir.

export interface Explanation {
  code: string;
  oQueE: string;
  porQueImporta: string;
  base: string;
  comoCorrigir: string;
}

export const EXPLANATIONS: Record<string, Explanation> = {
  'tracker-sem-consentimento': {
    code: 'tracker-sem-consentimento',
    oQueE: 'Um rastreador (analytics ou marketing) que pode disparar antes de o visitante aceitar os cookies.',
    porQueImporta: 'Cookies não essenciais coletam dado pessoal. Dispará-los antes do aceite trata dado sem base legal, e é a violação de LGPD mais comum em sites.',
    base: 'LGPD art. 7 (bases legais) e art. 8 (consentimento). Guia de Cookies da ANPD (2022).',
    comoCorrigir: 'Rode guard_generate_cookie_banner: ele carrega o banner antes de tudo e bloqueia cada rastreador até o consentimento.',
  },
  'form-sem-consentimento': {
    code: 'form-sem-consentimento',
    oQueE: 'Um formulário que coleta dado pessoal (e-mail, telefone, CPF) sem pedir consentimento.',
    porQueImporta: 'Coletar dado pessoal exige base legal e transparência. Sem o aceite registrado, você não tem como provar o consentimento se for questionado.',
    base: 'LGPD art. 8 (consentimento por escrito ou meio que demonstre a manifestação) e art. 9 (informação ao titular).',
    comoCorrigir: 'Rode guard_add_consent_point: ele adiciona um checkbox de consentimento com base legal e link de política, e registra o aceite.',
  },
  'transferencia-internacional': {
    code: 'transferencia-internacional',
    oQueE: 'Dado pessoal tratado por serviços fora do Brasil (Google, AWS, um SaaS estrangeiro).',
    porQueImporta: 'A transferência internacional tem regras próprias e precisa ser informada ao titular. Quase nenhum site declara isso, e é fiscalizável.',
    base: 'LGPD Capítulo V, art. 33 a 36 (transferência internacional de dados).',
    comoCorrigir: 'Liste os terceiros estrangeiros na política de privacidade (guard_generate_policy já faz isso) e garanta cláusulas contratuais adequadas com cada fornecedor.',
  },
  'sem-link-politica': {
    code: 'sem-link-politica',
    oQueE: 'O site trata dado pessoal mas não tem link visível para a política de privacidade.',
    porQueImporta: 'A LGPD exige transparência: o titular precisa conseguir ler como os dados dele são tratados. Sem a política publicada, não há transparência.',
    base: 'LGPD art. 6, VI (transparência) e art. 9 (acesso facilitado à informação).',
    comoCorrigir: 'Rode guard_generate_policy para gerar a política a partir do seu código, publique-a e linke no rodapé de todas as páginas.',
  },
};

export function explain(code: string): Explanation | undefined {
  return EXPLANATIONS[code];
}
