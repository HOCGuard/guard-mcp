import { detectTrackers, TRACKER_RULES, type SourceFile } from './trackers.ts';
import { detectForms } from './forms.ts';
import { detectTransfers, TRANSFER_RULES } from './transfers.ts';

// Diagnóstico local de conformidade LGPD. Estático, roda sem backend: lê o
// código e aponta o que está fora, sem varrer o site no ar.

export type Severity = 'alta' | 'media' | 'baixa';

export interface Finding {
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  files: string[];
  /** Achados vêm de correspondência de padrões; sempre 'media' aqui. */
  confidence: 'alta' | 'media' | 'baixa';
  /** Primeira linha que casou (arquivo:linha), para o humano auditar (cenário 3). */
  evidence?: string | undefined;
}

const POLICY_LINK = /politica-de-privacidade|privacy-policy|pol[íi]tica de privacidade|privacy_policy/i;

// Aviso de método: análise estática não vê o injetado em runtime (cenário 2).
export const METODO = 'Análise estática do código. Não vê rastreadores injetados em runtime (GTM, CMS). Confirme no site publicado com guard_scan_site.';

// Acha a primeira linha de qualquer arquivo que case com um dos padrões.
function evidenceLine(files: SourceFile[], paths: string[], patterns: RegExp[]): string | undefined {
  for (const p of paths) {
    const file = files.find((f) => f.path === p);
    if (!file) continue;
    const linhas = file.content.split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (patterns.some((re) => re.test(linhas[i]!))) {
        return `${p}:${i + 1}: ${linhas[i]!.trim().slice(0, 120)}`;
      }
    }
  }
  return undefined;
}

export function checkCompliance(files: SourceFile[]): { findings: Finding[]; score: number; metodo: string } {
  const findings: Finding[] = [];
  const trackers = detectTrackers(files);
  const forms = detectForms(files);

  const naoEssenciais = trackers.filter((t) => t.purpose !== 'necessary');
  if (naoEssenciais.length > 0) {
    const arquivos = [...new Set(naoEssenciais.flatMap((t) => t.files))];
    findings.push({
      severity: 'alta',
      code: 'tracker-sem-consentimento',
      title: 'Rastreador não essencial pode disparar antes do consentimento',
      detail: `Encontrei ${naoEssenciais.map((t) => t.provider).join(', ')}. Sob a LGPD, cookies não essenciais só podem disparar após o aceite. Rode guard_generate_cookie_banner para bloqueá-los até o consentimento.`,
      files: arquivos,
      confidence: 'media',
      evidence: evidenceLine(files, arquivos, naoEssenciais.flatMap((t) => TRACKER_RULES.find((r) => r.id === t.id)?.patterns ?? [])),
    });
  }

  const formsSemConsentimento = forms.filter((f) => !f.hasConsent);
  if (formsSemConsentimento.length > 0) {
    findings.push({
      severity: 'alta',
      code: 'form-sem-consentimento',
      title: 'Formulário coleta dado pessoal sem consentimento',
      detail: `${formsSemConsentimento.length} formulário(s) coletam dado pessoal (${[...new Set(formsSemConsentimento.flatMap((f) => f.fields))].join(', ')}) sem ponto de coleta de consentimento. Rode guard_add_consent_point.`,
      files: formsSemConsentimento.map((f) => f.path),
      confidence: 'media',
    });
  }

  const transfers = detectTransfers(files);
  if (transfers.length > 0) {
    const arquivos = [...new Set(transfers.flatMap((t) => t.files))];
    findings.push({
      severity: 'media',
      code: 'transferencia-internacional',
      title: 'Dado pessoal pode ser transferido para fora do Brasil',
      detail: `Serviços estrangeiros no código: ${transfers.map((t) => `${t.service} (${t.country})`).join('; ')}. A LGPD (art. 33) exige base legal e transparência para transferência internacional. Informe esses terceiros na política de privacidade.`,
      files: arquivos,
      confidence: 'media',
      evidence: evidenceLine(files, arquivos, transfers.flatMap((t) => TRANSFER_RULES.find((r) => r.id === t.id)?.patterns ?? [])),
    });
  }

  const temPolitica = files.some((f) => POLICY_LINK.test(f.content));
  const coletaDado = trackers.length > 0 || forms.length > 0;
  if (coletaDado && !temPolitica) {
    findings.push({
      severity: 'media',
      code: 'sem-link-politica',
      title: 'Sem link para a política de privacidade',
      detail: 'O site trata dado pessoal (rastreador ou formulário) mas não encontrei link para a política de privacidade. A LGPD exige transparência: publique a política e linke no rodapé.',
      files: [],
      confidence: 'media',
    });
  }

  return { findings, score: scoreOf(findings), metodo: METODO };
}

// Nota simples: 100 menos peso por achado. Alta -35, média -15, baixa -5.
export function scoreOf(findings: Finding[]): number {
  const peso = { alta: 35, media: 15, baixa: 5 } as const;
  return Math.max(0, 100 - findings.reduce((s, f) => s + peso[f.severity], 0));
}
