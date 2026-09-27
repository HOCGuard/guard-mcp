import type { DetectedTracker, Router } from './trackers.ts';
import type { Framework } from './framework.ts';

// Gera a integração do banner.js do HOC Guard (hoc-mod-gcc/sdk) num projeto
// Next. O SDK já existe: aqui só automatizamos o passo que hoje é manual no
// painel, colar o <script data-banner-id> e reclassificar os rastreadores.

export interface BannerPlan {
  router: Router;
  bannerId: string | null;
  sdkUrl: string;
  trackers: DetectedTracker[];
  framework?: Framework;
  // Idempotência (cenário 4): true quando o banner.js já está no projeto.
  alreadyInstalled?: boolean;
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

// Aviso informativo, para sites que só têm cookies essenciais (sessão, login,
// CSRF). A LGPD não exige consentimento para esses, mas exige transparência:
// informar que existem e linkar a política. É uma barra informativa, não uma
// parede de aceitar/recusar.
function noticeFile(): GeneratedFile {
  return {
    path: 'components/CookieNotice.tsx',
    action: 'create',
    code: [
      "'use client';",
      "import { useEffect, useState } from 'react';",
      '',
      'export function CookieNotice() {',
      '  const [visivel, setVisivel] = useState(false);',
      '  useEffect(() => {',
      "    try { setVisivel(localStorage.getItem('cookie-aviso') !== 'ok'); } catch { setVisivel(true); }",
      '  }, []);',
      '  if (!visivel) return null;',
      "  function ok() { try { localStorage.setItem('cookie-aviso', 'ok'); } catch {} setVisivel(false); }",
      '  return (',
      '    <div role="region" aria-label="Aviso de cookies" style={{ position: \'fixed\', bottom: 0, left: 0, right: 0, padding: \'1rem\', background: \'#111\', color: \'#fff\', display: \'flex\', gap: \'1rem\', alignItems: \'center\', justifyContent: \'center\', flexWrap: \'wrap\', zIndex: 9999 }}>',
      '      <span>Usamos apenas cookies essenciais para o funcionamento do site. Saiba mais na nossa <a href="/politica-de-privacidade" style={{ color: \'#fff\', textDecoration: \'underline\' }}>Política de Privacidade</a>.</span>',
      '      <button onClick={ok} style={{ padding: \'0.5rem 1rem\', borderRadius: 6, border: 0, cursor: \'pointer\' }}>Entendi</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n'),
    note: 'Barra informativa (sem consentimento) para cookies essenciais. Importe e renderize <CookieNotice /> no layout raiz. Ajuste o link para a URL real da sua política.',
  };
}

// Integração genérica por <script>, para frameworks que não são Next.js. Em vez
// de assumir Next e gerar código errado em silêncio (cenário 1).
function genericScriptFile(plan: BannerPlan): GeneratedFile {
  const id = plan.bannerId ?? PLACEHOLDER_ID;
  const origin = new URL(plan.sdkUrl).origin;
  return {
    path: 'index.html (ou o HTML raiz do seu framework)',
    action: 'edit',
    code: [
      '<!-- no <head>, antes de qualquer outro script: -->',
      `<script src="${plan.sdkUrl}" data-banner-id="${id}" data-api-base="${origin}"></script>`,
    ].join('\n'),
    note: 'Framework não-Next: carregue o banner.js pela tag <script> no HTML raiz, antes de qualquer rastreador. Rode o build depois e confirme que o data-banner-id aparece no HTML final.',
  };
}

export type IntegrationMode = 'consent-gate' | 'notice' | 'already-installed';

export function buildBannerIntegration(plan: BannerPlan): { mode: IntegrationMode; files: GeneratedFile[]; purposes: string[]; warnings: string[] } {
  const warnings: string[] = [];

  // Idempotência (cenário 4): já tem o banner.js, não gera de novo.
  if (plan.alreadyInstalled) {
    return {
      mode: 'already-installed',
      files: [],
      purposes: ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))],
      warnings: ['O banner.js do HOC Guard já está no projeto. Não gerei nada para não duplicar. Rode guard_check_compliance para conferir se está bloqueando os rastreadores.'],
    };
  }

  const framework = plan.framework ?? 'nextjs';
  const naoNext = framework !== 'nextjs' && framework !== 'unknown';

  // Sem rastreador não essencial: a LGPD não pede consentimento, só
  // transparência. Gera o aviso informativo em vez de uma parede inócua.
  if (plan.trackers.length === 0) {
    warnings.push(
      'Nenhum rastreador não essencial no código. Gerei um aviso informativo (LGPD exige transparência mesmo só com cookies essenciais), não uma parede de consentimento.',
    );
    warnings.push('Se algum rastreador é injetado por GTM ou CMS, rode guard_scan_site no site publicado: se houver analytics/marketing, troque para o banner de consentimento.');
    if (plan.router === 'unknown') {
      warnings.push('Não achei app/layout nem pages/_document; confirme onde fica o layout raiz para importar o <CookieNotice />.');
    }
    return { mode: 'notice', files: [noticeFile()], purposes: ['necessary'], warnings };
  }

  const layout = naoNext ? genericScriptFile(plan) : layoutFile(plan);
  const files = [layout, ...plan.trackers.flatMap(trackerFix)];
  const purposes = ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))];
  if (!plan.bannerId) {
    warnings.push(
      `Sem banner_id: troque ${PLACEHOLDER_ID} pelo id do banner criado no painel do HOC Guard. A criação anônima pelo MCP (Hguard-1424) ainda não está no ar.`,
    );
  }
  if (naoNext) {
    warnings.push(`Framework detectado: ${framework}. Gerei a integração genérica por <script>; ajuste o local no HTML raiz do seu framework.`);
  } else if (plan.router === 'unknown') {
    warnings.push('Não achei app/layout nem pages/_document; assumi App Router. Confirme onde fica o layout raiz.');
  }
  return { mode: 'consent-gate', files, purposes, warnings };
}

function indent(block: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return block.split('\n').map((l) => pad + l).join('\n');
}

// Detecta se o banner.js do HOC Guard já está no projeto (cenário 4).
export function bannerInstalled(files: { content: string }[]): boolean {
  return files.some((f) => /sdk\/banner\.js|data-banner-id|HOCGuardSettings/.test(f.content));
}
