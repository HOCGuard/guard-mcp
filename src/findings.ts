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

export interface RawReport {
  report_id?: string;
  url?: string;
  framework?: string;
  score?: { overall?: number; grade?: string };
  checks?: RawCheck[];
  dark_patterns?: RawDarkPattern[];
}

export interface Finding {
  id: string;
  severity: Severity;
  label: string;
  detail?: string;
  kind: 'check' | 'dark_pattern';
  uncertain?: true;
}

export interface ScanSummary {
  url?: string;
  grade?: string;
  score?: number;
  counts: { critical: number; high: number; medium: number; low: number; passed: number; uncertain: number };
  findings: Finding[];
  truncated?: number;
}

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

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const summary: ScanSummary = { counts, findings: findings.slice(0, limit) };
  if (report.url !== undefined) summary.url = report.url;
  if (report.score?.grade !== undefined) summary.grade = report.score.grade;
  if (report.score?.overall !== undefined) summary.score = report.score.overall;
  if (findings.length > limit) summary.truncated = findings.length - limit;
  return summary;
}
