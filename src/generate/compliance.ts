import { detectTrackers, type SourceFile } from './trackers.ts';
import { detectForms } from './forms.ts';
import { detectTransfers } from './transfers.ts';

// Diagnóstico local de conformidade LGPD. Estático, roda sem backend: lê o
// código e aponta o que está fora, sem varrer o site no ar.

export type Severity = 'alta' | 'media' | 'baixa';

export interface Finding {
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  files: string[];
}

const POLICY_LINK = /politica-de-privacidade|privacy-policy|pol[íi]tica de privacidade|privacy_policy/i;

export function checkCompliance(files: SourceFile[]): { findings: Finding[]; score: number } {
  const findings: Finding[] = [];
  const trackers = detectTrackers(files);
  const forms = detectForms(files);

  const naoEssenciais = trackers.filter((t) => t.purpose !== 'necessary');
  if (naoEssenciais.length > 0) {
    findings.push({
      severity: 'alta',
      code: 'tracker-sem-consentimento',
      title: 'Rastreador não essencial pode disparar antes do consentimento',
      detail: `Encontrei ${naoEssenciais.map((t) => t.provider).join(', ')}. Sob a LGPD, cookies não essenciais só podem disparar após o aceite. Rode guard_generate_cookie_banner para bloqueá-los até o consentimento.`,
      files: [...new Set(naoEssenciais.flatMap((t) => t.files))],
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
    });
  }

  const transfers = detectTransfers(files);
  if (transfers.length > 0) {
    findings.push({
      severity: 'media',
      code: 'transferencia-internacional',
      title: 'Dado pessoal pode ser transferido para fora do Brasil',
      detail: `Serviços estrangeiros no código: ${transfers.map((t) => `${t.service} (${t.country})`).join('; ')}. A LGPD (art. 33) exige base legal e transparência para transferência internacional. Informe esses terceiros na política de privacidade.`,
      files: [...new Set(transfers.flatMap((t) => t.files))],
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
    });
  }

  return { findings, score: scoreOf(findings) };
}

// Nota simples: 100 menos peso por achado. Alta -35, média -15, baixa -5.
export function scoreOf(findings: Finding[]): number {
  const peso = { alta: 35, media: 15, baixa: 5 } as const;
  return Math.max(0, 100 - findings.reduce((s, f) => s + peso[f.severity], 0));
}
