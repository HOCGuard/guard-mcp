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

// --- Hguard-2580: veredito na mesma régua do relatório do Guard ---

test('relatório medido sem incerteza importante sai confirmado, com nota e score', () => {
  const s = summarize({ ...report, score: { overall: 42, grade: 'D', summary: { coverage_ratio: 0.93 } } });
  assert.equal(s.verdict, 'confirmado');
  assert.equal(s.grade, 'D');
  assert.equal(s.score, 42);
  assert.equal(s.coverage, 93);
  assert.match(s.verdict_note, /93%/);
});

test('nota 100 com item crítico não confirmado é preliminar e perde o score (caso grupohoc.com.br, 01/11)', () => {
  const s = summarize({
    url: 'https://grupohoc.com.br',
    score: { overall: 100, grade: 'B', summary: { coverage_ratio: 0.87, core_unverified: true } },
    checks: [
      { id: 'banner_present', label: 'Banner', status: 'pass', severity: 'critical' },
      { id: 'lgpd_legal_basis_declared', label: 'Base legal', status: 'uncertain', severity: 'critical' },
      { id: 'no_close_accept', label: 'Fechar não aceita', status: 'uncertain', severity: 'critical' },
      { id: 'lgpd_dpo_accessible', label: 'Encarregado', status: 'uncertain', severity: 'high' },
      { id: 'gpc_signal_respected', label: 'GPC', status: 'uncertain', severity: 'low' },
    ],
  });
  assert.equal(s.verdict, 'preliminar');
  assert.equal(s.grade, 'B');
  assert.equal(s.score, undefined);
  assert.equal(s.counts.uncertain_important, 3);
  assert.match(s.verdict_note, /3 itens importantes não foram confirmados/);
  assert.match(s.verdict_note, /Não diga que o site está conforme/);
});

test('página não vista: sem nota, sem score e o motivo no texto', () => {
  const s = summarize({
    url: 'https://seuimposto.com',
    score: { overall: null, summary: { coverage_ratio: 1 } },
    phase_status: { initial: { status: 'measured', page_seen: { status: 'blocked' } } },
    checks: [{ id: 'banner_present', label: 'Banner', status: 'uncertain', severity: 'critical' }],
  });
  assert.equal(s.verdict, 'nao_vimos_o_site');
  assert.equal(s.grade, undefined);
  assert.equal(s.score, undefined);
  assert.match(s.verdict_note, /página de bloqueio/);
});

test('overall nulo sem phase_status também é página não vista', () => {
  assert.equal(summarize({ score: { overall: null }, checks: [] }).verdict, 'nao_vimos_o_site');
});

test('recusa não medida deixa o resultado preliminar e aparece em not_measured', () => {
  const s = summarize({
    score: { overall: 80, grade: 'B' },
    phase_status: { initial: { status: 'measured', page_seen: { status: 'seen' } }, reject: { status: 'not_measured', reason: 'control_not_found' } },
    checks: [{ id: 'banner_present', label: 'Banner', status: 'pass', severity: 'critical' }],
  });
  assert.equal(s.verdict, 'preliminar');
  assert.deepEqual(s.not_measured, [{ phase: 'reject', reason: 'control_not_found' }]);
  assert.match(s.verdict_note, /recusar os cookies/);
});

test('na mesma severidade, falha confirmada vem antes da incerta', () => {
  const s = summarize({
    score: { overall: 50, grade: 'C' },
    checks: [
      { id: 'a_incerto', label: 'a', status: 'uncertain', severity: 'critical' },
      { id: 'b_falha', label: 'b', status: 'fail', severity: 'critical' },
    ],
  });
  assert.deepEqual(s.findings.map(f => f.id), ['b_falha', 'a_incerto']);
});
