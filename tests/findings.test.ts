import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, type RawReport } from '../src/findings.ts';

const report: RawReport = {
  url: 'https://exemplo.com.br',
  score: { overall: 42, grade: 'D' },
  checks: [
    { id: 'no_pre_consent_firing', label: 'Sem disparo antes do consentimento', status: 'fail', severity: 'critical', result_detail: '  3   rastreadores\ndispararam  ' },
    { id: 'banner_present', label: 'Banner presente', status: 'pass', severity: 'high' },
    { id: 'reject_button', label: 'Botão rejeitar visível', status: 'fail', severity: 'medium' },
    { id: 'dpo_contact', label: 'Contato do encarregado', status: 'uncertain', severity: 'low' },
    { id: 'tcf_support', label: 'Suporte a TCF', status: 'not_applicable', severity: 'low' },
  ],
  dark_patterns: [{ id: 'confirm_shaming', label: 'Confirm shaming', severity: 'high', description: 'Texto culpa o usuário' }],
};

test('esconde o que passou e o que não se aplica', () => {
  const s = summarize(report);
  const ids = s.findings.map(f => f.id);
  assert.ok(!ids.includes('banner_present'));
  assert.ok(!ids.includes('tcf_support'));
  assert.equal(s.counts.passed, 1);
});

test('ordena do mais grave para o menos grave', () => {
  const s = summarize(report);
  assert.deepEqual(s.findings.map(f => f.severity), ['critical', 'high', 'medium', 'low']);
});

test('conta por severidade e separa incerto', () => {
  const s = summarize(report);
  assert.equal(s.counts.critical, 1);
  assert.equal(s.counts.high, 1);
  assert.equal(s.counts.medium, 1);
  assert.equal(s.counts.uncertain, 1);
  assert.equal(s.counts.low, 0);
});

test('normaliza espaço em branco do detalhe', () => {
  const s = summarize(report);
  assert.equal(s.findings[0]?.detail, '3 rastreadores dispararam');
});

test('dark pattern entra como achado', () => {
  const s = summarize(report);
  const dp = s.findings.find(f => f.id === 'confirm_shaming');
  assert.equal(dp?.kind, 'dark_pattern');
});

test('include_passed traz o que passou', () => {
  const s = summarize(report, { includePassed: true });
  assert.ok(s.findings.some(f => f.id === 'banner_present'));
});

test('limita a lista e informa quanto sobrou', () => {
  const s = summarize(report, { limit: 2 });
  assert.equal(s.findings.length, 2);
  assert.equal(s.truncated, 2);
});

test('corta detalhe muito longo', () => {
  const longo: RawReport = { checks: [{ id: 'x', label: 'x', status: 'fail', severity: 'low', result_detail: 'a'.repeat(400) }] };
  const detail = summarize(longo).findings[0]?.detail ?? '';
  assert.ok(detail.length <= 240);
  assert.ok(detail.endsWith('…'));
});
