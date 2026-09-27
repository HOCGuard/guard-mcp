import type { DetectedTracker, Router } from './trackers.ts';

// Gera a integração do banner.js do HOC Guard (hoc-mod-gcc/sdk) num projeto
// Next. O SDK já existe: aqui só automatizamos o passo que hoje é manual no
// painel, colar o <script data-banner-id> e reclassificar os rastreadores.

export interface BannerPlan {
  router: Router;
  bannerId: string | null;
  sdkUrl: string;
  trackers: DetectedTracker[];
}

export interface GeneratedFile {
  path: string;
  action: 'create' | 'edit';
  code: string;
  note: string;
}

const PLACEHOLDER_ID = 'SEU_BANNER_ID';

export function scriptTag(plan: BannerPlan): string {
  const id = plan.bannerId ?? PLACEHOLDER_ID;
  const origin = new URL(plan.sdkUrl).origin;
  return [
    '<Script',
    `  src="${plan.sdkUrl}"`,
    `  data-banner-id="${id}"`,
    `  data-api-base="${origin}"`,
    '  strategy="beforeInteractive"',
    '/>',
  ].join('\n');
}

function layoutFile(plan: BannerPlan): GeneratedFile {
  if (plan.router === 'pages') {
    return {
      path: 'pages/_document.tsx',
      action: 'edit',
      code: [
        "import { Html, Head, Main, NextScript } from 'next/document';",
        "import Script from 'next/script';",
        '',
        'export default function Document() {',
        '  return (',
        '    <Html lang="pt-BR">',
        '      <Head />',
        '      <body>',
        '        <Main />',
        '        <NextScript />',
        indent(scriptTag(plan), 8),
        '      </body>',
        '    </Html>',
        '  );',
        '}',
      ].join('\n'),
      note: 'No Pages Router, scripts beforeInteractive só funcionam em _document. Mantenha o que já existe no arquivo e acrescente o <Script>.',
    };
  }
  return {
    path: 'app/layout.tsx',
    action: 'edit',
    code: [
      "import Script from 'next/script';",
      '',
      '// dentro de <html>, antes de qualquer rastreador:',
      '<head>',
      indent(scriptTag(plan), 2),
      '</head>',
    ].join('\n'),
    note: 'O banner.js precisa carregar antes de qualquer tag: ele instala o Consent Mode v2 com tudo negado e só libera após a escolha do visitante.',
  };
}

function trackerFix(tracker: DetectedTracker): GeneratedFile[] {
  if (tracker.consentMode) {
    return tracker.files.map((path) => ({
      path,
      action: 'edit' as const,
      code: '// Nenhuma mudança de código: esta tag do Google respeita o Consent Mode v2.',
      note: `${tracker.provider} fica bloqueado até o consentimento de ${tracker.purpose} desde que carregue depois do banner.js.`,
    }));
  }
  return tracker.files.map((path) => ({
    path,
    action: 'edit' as const,
    code: [
      '<script',
      '  type="text/plain"',
      `  data-purpose="${tracker.purpose}"`,
      `  dangerouslySetInnerHTML={{ __html: \`/* código original do ${tracker.provider}, sem alteração */\` }}`,
      '/>',
    ].join('\n'),
    note: `${tracker.provider} dispara sem pedir consentimento. Troque a tag por type="text/plain" com data-purpose="${tracker.purpose}": o banner.js só a ativa após o aceite. Se vier de pacote npm, inicialize-o dentro de window.addEventListener('hocgcc:consent', ...) quando ${tracker.purpose} estiver aceito.`,
  }));
}

export function buildBannerIntegration(plan: BannerPlan): { files: GeneratedFile[]; purposes: string[]; warnings: string[] } {
  const files = [layoutFile(plan), ...plan.trackers.flatMap(trackerFix)];
  const purposes = ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))];
  const warnings: string[] = [];
  if (!plan.bannerId) {
    warnings.push(
      `Sem banner_id: troque ${PLACEHOLDER_ID} pelo id do banner criado no painel do HOC Guard. A criação anônima pelo MCP (Hguard-1424) ainda não está no ar.`,
    );
  }
  if (plan.router === 'unknown') {
    warnings.push('Não achei app/layout nem pages/_document; assumi App Router. Confirme onde fica o layout raiz.');
  }
  if (plan.trackers.length === 0) {
    warnings.push('Nenhum rastreador conhecido no código. Se algum é injetado por GTM ou por CMS, rode guard_scan_site no site publicado para confirmar.');
  }
  return { files, purposes, warnings };
}

function indent(block: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return block.split('\n').map((l) => pad + l).join('\n');
}
