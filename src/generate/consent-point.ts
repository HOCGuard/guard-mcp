import type { DetectedForm } from './forms.ts';

export interface GeneratedFile {
  path: string;
  action: 'create' | 'edit';
  code: string;
  note: string;
}

// Componente de ponto de coleta: checkbox de consentimento com base legal e
// link de política, sobre o collection-point do HOC Guard (gcc). Gerado uma vez
// e reusado em cada formulário que coleta dado pessoal.
function consentFieldComponent(): GeneratedFile {
  return {
    path: 'components/ConsentField.tsx',
    action: 'create',
    code: [
      "'use client';",
      '',
      '// Ponto de coleta de consentimento (LGPD art. 8). Registra o aceite no',
      '// HOC Guard via data-hoc-collection-point; o SDK captura no submit.',
      'export function ConsentField({ pointId }: { pointId: string }) {',
      '  return (',
      '    <label style={{ display: \'flex\', gap: \'0.5rem\', alignItems: \'flex-start\', fontSize: \'0.9rem\' }}>',
      '      <input type="checkbox" name="consent" required data-hoc-collection-point={pointId} />',
      '      <span>',
      '        Li e concordo com o tratamento dos meus dados conforme a{\' \'}',
      '        <a href="/politica-de-privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.',
      '      </span>',
      '    </label>',
      '  );',
      '}',
    ].join('\n'),
    note: 'Componente do ponto de coleta. required garante que o envio só ocorre com aceite. Troque pointId pelo id do ponto criado no painel; ajuste o link da política.',
  };
}

export function buildConsentPoints(forms: DetectedForm[]): { files: GeneratedFile[]; warnings: string[] } {
  const alvo = forms.filter((f) => !f.hasConsent);
  if (alvo.length === 0) {
    return {
      files: [],
      warnings: ['Nenhum formulário sem consentimento. Todos os formulários com dado pessoal já têm um sinal de aceite.'],
    };
  }
  const files: GeneratedFile[] = [consentFieldComponent()];
  for (const form of alvo) {
    files.push({
      path: form.path,
      action: 'edit',
      code: [
        "import { ConsentField } from '@/components/ConsentField';",
        '',
        '// dentro do <form>, antes do botão de envio:',
        '<ConsentField pointId="SEU_POINT_ID" />',
      ].join('\n'),
      note: `Formulário coleta ${form.fields.join(', ')} sem consentimento. Acrescente o <ConsentField /> antes do submit.`,
    });
  }
  const warnings = ['Troque SEU_POINT_ID pelo id do ponto de coleta criado no painel do HOC Guard.'];
  return { files, warnings };
}
