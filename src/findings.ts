export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type CheckStatus = 'pass' | 'fail' | 'warning' | 'uncertain' | 'not_applicable';

export interface RawCheck {
  id: string;
  category?: string;
  label: string;
  status: CheckStatus;
  severity: Severity;
  result_detail?: string;
  confidence?: number;
}

export interface RawDarkPattern {
  id: string;
  type?: string;
  label: string;
  description?: string;
  severity: Severity;
  normative_ref?: string;
}

export interface RawPhaseStatus {
  status?: 'measured' | 'not_measured' | string;
  reason?: string;
  page_seen?: { status?: string } | null;
}

export interface RawReport {
  report_id?: string;
  url?: string;
  framework?: string;
  /** overall null e grade ausente quando a página não foi vista (portão de visão, Hguard-2351). */
  score?: {
    overall?: number | null;
    grade?: string;
    summary?: {
      coverage_ratio?: number;
      low_confidence?: boolean;
      core_unverified?: boolean;
      core_unverified_checks?: string[];
    };
  };
  checks?: RawCheck[];
  dark_patterns?: RawDarkPattern[];
  phase_status?: Record<string, RawPhaseStatus>;
  inconclusive?: boolean;
  inconclusive_reason?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  label: string;
  detail?: string;
  kind: 'check' | 'dark_pattern';
  uncertain?: true;
}

/**
 * Hguard-2580: o que a varredura permite afirmar, na mesma régua do relatório
 * do Guard (Hguard-2351): página não vista não aprova nem reprova, e nota com
 * item importante não confirmado é provisória.
 */
export type Verdict = 'confirmado' | 'preliminar' | 'nao_vimos_o_site';

export interface ScanSummary {
  url?: string;
  verdict: Verdict;
  verdict_note: string;
  /** Só quando há o que medir: ausente em nao_vimos_o_site. */
  grade?: string;
  /** Só em confirmado: número sem cobertura engana mais do que ajuda. */
  score?: number;
  /** Percentual de testes aplicáveis que deram resposta. */
  coverage?: number;
  not_measured?: Array<{ phase: string; reason?: string }>;
  counts: { critical: number; high: number; medium: number; low: number; passed: number; uncertain: number; uncertain_important: number };
  findings: Finding[];
  truncated?: number;
}

const FASES: Record<string, string> = {
  initial: 'abrir a página',
  accept: 'aceitar os cookies',
  reject: 'recusar os cookies',
  mobile: 'celular',
  revocation: 'revogar o consentimento',
};

const PAGINA_NAO_VISTA: Record<string, string> = {
  blocked: 'o site mostrou uma página de bloqueio ao navegador da varredura',
  empty: 'a página veio em branco',
  error_page: 'o site devolveu uma página de erro',
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function trim(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// O relatório bruto traz centenas de cookies, requisições e evidências. Mandar
// isso inteiro para o agente estoura o contexto antes de ele conseguir agir.
export function summarize(report: RawReport, options: { includePassed?: boolean; limit?: number } = {}): ScanSummary {
  const limit = options.limit ?? 40;
  const checks = report.checks ?? [];

  const counts = { critical: 0, high: 0, medium: 0, low: 0, passed: 0, uncertain: 0 };
  const findings: Finding[] = [];

  for (const check of checks) {
    if (check.status === 'pass') {
      counts.passed += 1;
      if (!options.includePassed) continue;
    } else if (check.status === 'not_applicable') {
      continue;
    } else if (check.status === 'uncertain') {
      counts.uncertain += 1;
    } else {
      counts[check.severity] += 1;
    }

    const finding: Finding = {
      id: check.id,
      severity: check.severity,
      label: check.label,
      kind: 'check',
    };
    const detail = trim(check.result_detail, 240);
    if (detail) finding.detail = detail;
    if (check.status === 'uncertain') finding.uncertain = true;
    findings.push(finding);
  }

  for (const pattern of report.dark_patterns ?? []) {
    counts[pattern.severity] += 1;
    const finding: Finding = {
      id: pattern.id,
      severity: pattern.severity,
      label: pattern.label,
      kind: 'dark_pattern',
    };
    const detail = trim(pattern.description, 240);
    if (detail) finding.detail = detail;
    findings.push(finding);
  }

  // Mais grave primeiro; na mesma severidade, o confirmado antes do incerto.
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || Number(!!a.uncertain) - Number(!!b.uncertain));

  const uncertainImportant = checks.filter((c) => c.status === 'uncertain' && (c.severity === 'critical' || c.severity === 'high')).length;
  const notMeasured = Object.entries(report.phase_status ?? {})
    .filter(([, p]) => p?.status === 'not_measured')
    .map(([phase, p]) => (p.reason ? { phase, reason: p.reason } : { phase }));
  const coverageRatio = report.score?.summary?.coverage_ratio;
  const { verdict, note } = decideVerdict(report, uncertainImportant, notMeasured);

  const summary: ScanSummary = {
    verdict,
    verdict_note: note,
    counts: { ...counts, uncertain_important: uncertainImportant },
    findings: findings.slice(0, limit),
  };
  if (report.url !== undefined) summary.url = report.url;
  if (verdict !== 'nao_vimos_o_site' && report.score?.grade !== undefined) summary.grade = report.score.grade;
  if (verdict === 'confirmado' && typeof report.score?.overall === 'number') summary.score = report.score.overall;
  if (typeof coverageRatio === 'number') summary.coverage = Math.round(coverageRatio * 100);
  if (notMeasured.length > 0) summary.not_measured = notMeasured;
  if (findings.length > limit) summary.truncated = findings.length - limit;
  return summary;
}

function paginaNaoVista(report: RawReport): string | null {
  const initial = report.phase_status?.['initial'];
  const visto = initial?.page_seen?.status;
  if (visto && visto !== 'seen') return PAGINA_NAO_VISTA[visto] ?? 'a página aberta não era o site';
  if (initial?.status === 'not_measured') return 'a página inicial não chegou a ser medida';
  if (report.inconclusive) return trim(report.inconclusive_reason, 160) ?? 'a análise ficou inconclusiva';
  if (report.score?.overall === null) return 'a página inicial não foi vista';
  return null;
}

function decideVerdict(
  report: RawReport,
  uncertainImportant: number,
  notMeasured: Array<{ phase: string }>,
): { verdict: Verdict; note: string } {
  const naoVista = paginaNaoVista(report);
  if (naoVista) {
    return {
      verdict: 'nao_vimos_o_site',
      note: `A varredura não viu o site de verdade: ${naoVista}. Não há nota, e nada aqui atesta nem reprova o site. Não diga que está conforme.`,
    };
  }

  const motivos: string[] = [];
  if (uncertainImportant > 0) motivos.push(`${uncertainImportant} ${uncertainImportant === 1 ? 'item importante não foi confirmado' : 'itens importantes não foram confirmados'}`);
  const fases = notMeasured.filter((f) => f.phase !== 'initial').map((f) => FASES[f.phase] ?? f.phase);
  if (fases.length > 0) motivos.push(`não deu para medir: ${fases.join(', ')}`);
  const resumo = report.score?.summary;
  if (motivos.length === 0 && (resumo?.low_confidence || resumo?.core_unverified)) motivos.push('parte dos testes ficou sem resposta');

  if (motivos.length > 0) {
    return {
      verdict: 'preliminar',
      note: `Resultado provisório: ${motivos.join('; ')}. Achado com uncertain:true não é falha nem acerto. Não diga que o site está conforme; diga o que falta confirmar.`,
    };
  }
  const cobertura = typeof resumo?.coverage_ratio === 'number' ? ` com ${Math.round(resumo.coverage_ratio * 100)}% dos testes respondidos` : '';
  return { verdict: 'confirmado', note: `Resultado medido${cobertura}.` };
}
