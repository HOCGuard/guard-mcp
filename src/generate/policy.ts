import type { SourceFile } from './trackers.ts';
import { detectTrackers } from './trackers.ts';
import { detectForms } from './forms.ts';
import { detectTransfers } from './transfers.ts';

// Gera uma política de privacidade que descreve o que o app REALMENTE faz,
// a partir dos rastreadores, campos de formulário e terceiros detectados no
// código. Não é template genérico. Estático, nada sai da máquina.

const PURPOSE_LABEL: Record<string, string> = {
  necessary: 'funcionamento do site',
  functional: 'preferências e funcionalidades',
  analytics: 'medição de audiência',
  marketing: 'publicidade e remarketing',
};

export interface PolicyInput {
  siteName?: string | undefined;
  controllerName?: string | undefined;
  dpoEmail?: string | undefined;
}

export function buildPolicy(files: SourceFile[], input: PolicyInput = {}): { markdown: string; warnings: string[] } {
  const trackers = detectTrackers(files);
  const forms = detectForms(files);
  const transfers = detectTransfers(files);
  const warnings: string[] = [];

  const site = input.siteName ?? '[NOME DO SITE]';
  const controller = input.controllerName ?? '[RAZÃO SOCIAL / CNPJ]';
  const dpo = input.dpoEmail ?? '[e-mail do encarregado]';
  const hoje = new Date().toISOString().slice(0, 10);

  const campos = [...new Set(forms.flatMap((f) => f.fields))];
  const linhas: string[] = [];
  linhas.push(`# Política de Privacidade — ${site}`);
  linhas.push('');
  linhas.push(`_Última atualização: ${hoje}. Base: Lei 13.709/2018 (LGPD)._`);
  linhas.push('');
  linhas.push('> Rascunho gerado a partir do que foi detectado no código do site. Revise com o');
  linhas.push('> jurídico antes de publicar e complete os campos entre colchetes.');
  linhas.push('');
  linhas.push('## 1. Quem é o controlador');
  linhas.push(`O controlador dos dados é ${controller}. Encarregado (DPO): ${dpo}.`);
  linhas.push('');
  linhas.push('## 2. Quais dados coletamos');
  if (campos.length) {
    linhas.push('Por meio de formulários, coletamos:');
    for (const c of campos) linhas.push(`- ${c}`);
  } else {
    linhas.push('Não identificamos formulários que coletam dado pessoal diretamente.');
  }
  linhas.push('');
  linhas.push('## 3. Cookies e tecnologias de rastreamento');
  if (trackers.length) {
    linhas.push('Utilizamos os seguintes serviços, por finalidade:');
    for (const t of trackers) linhas.push(`- **${t.provider}** — ${PURPOSE_LABEL[t.purpose] ?? t.purpose}`);
    const naoEssencial = trackers.some((t) => t.purpose !== 'necessary' && t.purpose !== 'functional');
    if (naoEssencial) linhas.push('\nOs cookies não essenciais só são ativados após o seu consentimento no banner.');
  } else {
    linhas.push('Utilizamos apenas cookies essenciais ao funcionamento do site.');
  }
  linhas.push('');
  linhas.push('## 4. Compartilhamento e transferência internacional');
  if (transfers.length) {
    linhas.push('Alguns dados podem ser tratados por serviços fora do Brasil:');
    for (const t of transfers) linhas.push(`- **${t.service}** — ${t.country}`);
    linhas.push('\nA transferência observa o art. 33 da LGPD (cláusulas contratuais e garantias adequadas).');
  } else {
    linhas.push('Não identificamos transferência internacional de dados.');
  }
  linhas.push('');
  linhas.push('## 5. Base legal');
  linhas.push('Cookies essenciais: legítimo interesse e necessidade. Cookies não essenciais e formulários de contato: consentimento (art. 7, I e art. 8).');
  linhas.push('');
  linhas.push('## 6. Direitos do titular');
  linhas.push(`Você pode confirmar, acessar, corrigir, anonimizar, portar ou excluir seus dados, e revogar o consentimento, escrevendo para ${dpo} (art. 18).`);
  linhas.push('');
  linhas.push('## 7. Retenção');
  linhas.push('Mantemos os dados pelo tempo necessário às finalidades acima ou conforme obrigação legal. [Defina os prazos].');
  linhas.push('');

  warnings.push('Rascunho gerado do código. Revise com o jurídico e preencha os campos entre colchetes antes de publicar.');
  if (!input.dpoEmail) warnings.push('Informe dpo_email para preencher o canal do titular.');

  return { markdown: linhas.join('\n'), warnings };
}
