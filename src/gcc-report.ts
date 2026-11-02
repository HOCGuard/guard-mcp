// Hguard-2582: com login que tem gcc:audit:*, a varredura passa pelo gcc e
// entra em Sites. O resultado vem do relatório do Guard (GET
// /api/v1/gcc/audits/:id/relatorio), a mesma conta que a tela mostra: aqui só
// é reduzido ao que o agente precisa para agir.
import type { Verdict } from './findings.ts';

export const GCC_SCAN_PREFIX = 'gcc:';

export interface GccAchado {
  id: string;
  grupo?: 'corrigir' | 'melhorar';
  titulo: string;
  acao?: string;
  porque?: string;
  certeza?: 'confirmado' | 'a_confirmar';
  em_conferencia?: boolean;
}

export interface GccRelatorio {
  analise?: {
    id?: string;
    url?: string;
    status?: 'queued' | 'running' | 'completed' | 'failed';
    nota?: string | null;
    score?: number | null;
    nota_parcial?: boolean;
    inconclusiva?: boolean;
    motivo_nao_visto?: 'blocked' | 'empty' | 'error_page' | null;
    erro?: string | null;
  };
  nota?: string | null;
  score?: number | null;
  nota_parcial?: boolean;
  completude?: 'completa' | 'parcial';
  fatores?: Array<{ id: string; nota?: string; problemas?: number }>;
  achados?: GccAchado[];
  a_confirmar?: GccAchado[];
  incertos?: Array<{ id: string; pergunta: string; motivo?: string }>;
  nao_medidos?: Array<{ id: string; titulo?: string; motivo?: string }>;
  acertos?: string[];
}

export interface GccFinding {
  id: string;
  label: string;
  kind: 'achado' | 'pergunta';
  priority?: 'corrigir' | 'melhorar';
  action?: string;
  detail?: string;
  uncertain?: true;
}

export interface GccScanSummary {
  url?: string;
  verdict: Verdict;
  verdict_note: string;
  grade?: string;
  score?: number;
  link: string;
  pillars?: Array<{ id: string; grade?: string; problems?: number }>;
  not_measured?: Array<{ phase: string; reason?: string }>;
  counts: { corrigir: number; melhorar: number; a_confirmar: number; perguntas: number; acertos: number };
  findings: GccFinding[];
  passed?: string[];
  truncated?: number;
}

const NAO_VISTO: Record<string, string> = {
  blocked: 'o site mostrou uma página de bloqueio ao navegador da varredura',
  empty: 'o site não carregou para a análise',
  error_page: 'o endereço devolveu uma página de erro',
};

function trim(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function reportLink(authOrigin: string, auditId: string): string {
  return `${authOrigin}/privacidade/scans/${encodeURIComponent(auditId)}`;
}

function achado(a: GccAchado, uncertain: boolean): GccFinding {
  const f: GccFinding = { id: a.id, label: a.titulo, kind: 'achado' };
  if (a.grupo) f.priority = a.grupo;
  const action = trim(a.acao, 200);
  if (action) f.action = action;
  const detail = trim(a.porque, 240);
  if (detail) f.detail = detail;
  if (uncertain || a.em_conferencia) f.uncertain = true;
  return f;
}

export function summarizeGccReport(rel: GccRelatorio, link: string, options: { includePassed?: boolean; limit?: number } = {}): GccScanSummary {
  const limit = options.limit ?? 40;
  const achados = rel.achados ?? [];
  const aConfirmar = rel.a_confirmar ?? [];
  const incertos = rel.incertos ?? [];
  const naoMedidos = rel.nao_medidos ?? [];
  const nota = rel.nota ?? rel.analise?.nota ?? null;
  const score = rel.score ?? rel.analise?.score ?? null;

  const counts = {
    corrigir: achados.filter((a) => a.grupo !== 'melhorar').length,
    melhorar: achados.filter((a) => a.grupo === 'melhorar').length,
    a_confirmar: aConfirmar.length,
    perguntas: incertos.length,
    acertos: rel.acertos?.length ?? 0,
  };

  let verdict: Verdict;
  let note: string;
  const naoVisto = rel.analise?.motivo_nao_visto;
  if (naoVisto) {
    verdict = 'nao_vimos_o_site';
    note = `A varredura não viu o site de verdade: ${NAO_VISTO[naoVisto] ?? 'a página aberta não era o site'}. Não há nota, e nada aqui atesta nem reprova o site. Não diga que está conforme; mande o link para a pessoa ver o que fazer.`;
  } else {
    const motivos: string[] = [];
    const titulos = naoMedidos.map((n) => n.titulo).filter((t): t is string => !!t);
    if (titulos.length > 0) motivos.push(`não deu para medir: ${titulos.join('; ')}`);
    if (aConfirmar.length > 0) motivos.push(`${aConfirmar.length} ${aConfirmar.length === 1 ? 'ponto depende' : 'pontos dependem'} de confirmação`);
    if (incertos.length > 0) motivos.push(`${incertos.length} ${incertos.length === 1 ? 'pergunta ficou' : 'perguntas ficaram'} para a pessoa responder no Guard`);
    if (motivos.length === 0 && (nota === null || rel.nota_parcial || rel.completude === 'parcial')) motivos.push('a análise ficou parcial');
    if (motivos.length > 0) {
      verdict = 'preliminar';
      note = `Resultado provisório${nota === null ? ', sem nota' : ''}: ${motivos.join('; ')}. Não diga que o site está conforme; diga o que falta e mande o link.`;
    } else {
      verdict = 'confirmado';
      note = 'Resultado medido, com a mesma conta do relatório do Guard.';
    }
  }

  const findings: GccFinding[] = [
    ...achados.filter((a) => a.grupo !== 'melhorar').map((a) => achado(a, false)),
    ...achados.filter((a) => a.grupo === 'melhorar').map((a) => achado(a, false)),
    ...aConfirmar.map((a) => achado(a, true)),
    ...incertos.map((i) => {
      const f: GccFinding = { id: i.id, label: i.pergunta, kind: 'pergunta', uncertain: true };
      const detail = trim(i.motivo, 240);
      if (detail) f.detail = detail;
      return f;
    }),
  ];

  const summary: GccScanSummary = { verdict, verdict_note: note, link, counts, findings: findings.slice(0, limit) };
  if (rel.analise?.url) summary.url = rel.analise.url;
  if (verdict !== 'nao_vimos_o_site' && nota) summary.grade = nota;
  if (verdict === 'confirmado' && typeof score === 'number') summary.score = score;
  if (rel.fatores?.length) {
    summary.pillars = rel.fatores.map((f) => {
      const p: { id: string; grade?: string; problems?: number } = { id: f.id };
      if (f.nota && verdict !== 'nao_vimos_o_site') p.grade = f.nota;
      if (typeof f.problemas === 'number') p.problems = f.problemas;
      return p;
    });
  }
  if (naoMedidos.length > 0) summary.not_measured = naoMedidos.map((n) => (n.motivo ? { phase: n.id, reason: trim(n.motivo, 160)! } : { phase: n.id }));
  if (options.includePassed && rel.acertos?.length) summary.passed = rel.acertos;
  if (findings.length > limit) summary.truncated = findings.length - limit;
  return summary;
}

/** Código estável a partir do texto de erro que o gcc guarda (sem repassar o texto). */
export function failureCodeFromText(erro: string | null | undefined): string {
  const t = (erro ?? '').toLowerCase();
  if (/robots\.txt/.test(t) && /(proib|disallow|bloque)/.test(t)) return 'blocked_by_robots_txt';
  if (/robots/.test(t)) return 'robots_unreachable';
  if (/timeout|tempo/.test(t)) return 'timeout';
  if (/captcha/.test(t)) return 'captcha_blocked';
  if (/net::|unreachable|enotfound|econnrefused|fora do ar/.test(t)) return 'site_unreachable';
  if (/redirect/.test(t)) return 'redirected_off_site';
  return 'internal_error';
}
