import type { Finding } from './compliance.ts';

// Relatório de conformidade em Markdown, para o fundador mandar a cliente ou DPO.
// A saída JSON serve ao agente; este texto serve a humanos.

// Análise estática nunca declara "conforme": não vê tracker injetado em runtime
// (GTM, CMS). O selo verde só sai com guard_scan_site no site publicado
// (cenário 8). Aqui a leitura é sempre sobre o código, não sobre o site.
function selo(score: number): string {
  if (score >= 90) return 'Sem problemas aparentes no código';
  if (score >= 60) return 'Ajustes necessários';
  return 'Problemas graves no código';
}

export function buildReport(score: number, findings: Finding[], siteName = '[site]'): string {
  const hoje = new Date().toISOString().slice(0, 10);
  const linhas: string[] = [];
  linhas.push(`# Relatório de conformidade LGPD — ${siteName}`);
  linhas.push('');
  linhas.push(`_Gerado em ${hoje} pelo HOC Guard. Análise estática do código._`);
  linhas.push('');
  linhas.push(`## Nota: ${score}/100 — ${selo(score)}`);
  linhas.push('');
  linhas.push('> Esta é uma análise estática do código. Ela não vê rastreadores injetados em');
  linhas.push('> runtime (GTM, CMS, tags de terceiros). Para confirmar a conformidade do site no ar,');
  linhas.push('> rode guard_scan_site na URL publicada.');
  linhas.push('');
  if (findings.length === 0) {
    linhas.push('Nenhum problema encontrado na análise estática do código.');
    return linhas.join('\n');
  }
  linhas.push(`${findings.length} ponto(s) de atenção, do mais grave para o menos grave:`);
  linhas.push('');
  const rotulo = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' } as const;
  const ordem = { alta: 0, media: 1, baixa: 2 } as const;
  for (const f of [...findings].sort((a, b) => ordem[a.severity] - ordem[b.severity])) {
    linhas.push(`### [${rotulo[f.severity]}] ${f.title}`);
    linhas.push(f.detail);
    if (f.files.length) linhas.push(`\nArquivos: ${f.files.join(', ')}`);
    linhas.push('');
  }
  return linhas.join('\n');
}
