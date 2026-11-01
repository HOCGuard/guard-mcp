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
  /** Instalado com <Script> de next/script (versões antigas do guard-mcp). */
  installedWithNextScript?: boolean;
}

export interface GeneratedFile {
  path: string;
  action: 'create' | 'edit';
  code: string;
  note: string;
}

const PLACEHOLDER_ID = 'SEU_BANNER_ID';

// Hguard-2581: segue o guia único de instalação do Guard
// (hoc_ui/src/features/gcc/pages/BannerWizard/instalacao/guia.ts). Mudar lá
// exige mudar aqui. O banner do assistente e o banner sem conta nascem com
// bloqueio prévio, então o snippet vai sem async e com data-autoblock="1",
// como PRIMEIRO script do <head>.
export function scriptTag(plan: BannerPlan): string {
  const id = plan.bannerId ?? PLACEHOLDER_ID;
  const origin = new URL(plan.sdkUrl).origin;
  return [
    '<script',
    `  src="${plan.sdkUrl}"`,
    `  data-banner-id="${id}"`,
    `  data-api-base="${origin}"`,
    '  data-autoblock="1"',
    '></script>',
  ].join('\n');
}

function layoutFile(plan: BannerPlan): GeneratedFile {
  if (plan.router === 'pages') {
    return {
      path: 'pages/_document.tsx',
      action: 'edit',
      code: [
        "import { Html, Head, Main, NextScript } from 'next/document';",
        '',
        'export default function Document() {',
        '  return (',
        '    <Html lang="pt-BR">',
        '      <Head>',
        '        {/* HOC Guard: primeiro script do <head>, antes de GTM, Analytics e pixels */}',
        indent(scriptTag(plan), 8),
        '      </Head>',
        '      <body>',
        '        <Main />',
        '        <NextScript />',
        '      </body>',
        '    </Html>',
        '  );',
        '}',
      ].join('\n'),
      note: 'Pages Router: o <script> do banner vai como PRIMEIRO filho de <Head> em _document, sem async nem defer. Mantenha o que já existe no arquivo. Se o ESLint acusar @next/next/no-sync-scripts, desligue a regra só nessa linha: o banner precisa rodar antes dos rastreadores.',
    };
  }
  return {
    path: 'app/layout.tsx',
    action: 'edit',
    code: [
      'export default function RootLayout({ children }: { children: React.ReactNode }) {',
      '  return (',
      '    <html lang="pt-BR">',
      '      <head>',
      '        {/* HOC Guard: primeiro script do <head>, antes de GTM, Analytics e pixels */}',
      indent(scriptTag(plan), 8),
      '      </head>',
      '      <body>{children}</body>',
      '    </html>',
      '  );',
      '}',
    ].join('\n'),
    note: 'App Router: um <script> comum como PRIMEIRO filho de <head> em app/layout.tsx, sem async nem defer. Não use <Script> de next/script: com strategy="beforeInteractive" ele entra depois dos scripts que já vêm no HTML. Mantenha o que já existe no layout.',
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
  return {
    path: 'index.html (ou o HTML raiz do seu framework)',
    action: 'edit',
    code: ['<!-- HOC Guard: primeiro script do <head>, antes de GTM, Analytics e pixels -->', scriptTag(plan)].join('\n'),
    note: 'Framework não-Next: o <script> do banner vai como primeiro script do <head> no HTML raiz (React com Vite/CRA: index.html; Angular: src/index.html; Nuxt 3: app.head.script em nuxt.config.ts, primeiro item; Astro: layout base; WordPress: wp_head com prioridade 1). Rode o build e confirme que o data-banner-id aparece no HTML final.',
  };
}

export type IntegrationMode = 'consent-gate' | 'notice' | 'already-installed';

/** Cuidados do guia de instalação, para o agente aplicar junto com as mudanças. */
export function installCautions(plan: BannerPlan): string[] {
  const host = new URL(plan.sdkUrl).host;
  return [
    'Uma cópia só: se a tag do banner.js já existir (inclusive com outro data-banner-id), substitua em vez de duplicar. Duas cópias travam o site quando o visitante aceita.',
    'SPA (Next.js, React Router, Vue Router): o <script> no <head> global cobre todas as rotas. Não reinjete por rota.',
    `Content-Security-Policy: se o projeto define CSP, libere ${host} em script-src e connect-src. Se a CSP usa nonce, ponha o nonce da página no <script> do banner (atributo nonce): o banner usa o mesmo no estilo. Sem nonce, permita estilo inline em style-src ('unsafe-inline'), senão o banner aparece simplificado.`,
    'Vídeo em <iframe> (YouTube é marketing, Vimeo é functional): troque src por data-hoc-src e acrescente data-hoc-cat com a categoria. data-purpose só vale em <script>.',
    'Não marque o Google Tag Manager (gtm.js): ele segue o Consent Mode.',
    'Não instale o banner por npm: o script vem da origem do Guard.',
  ];
}

/** Como conferir depois de aplicar. */
export function installVerify(plan: BannerPlan): string[] {
  const id = plan.bannerId ?? PLACEHOLDER_ID;
  return [
    'Abra o site numa janela anônima: o banner aparece na primeira visita. Teste no Chrome, Edge ou Safari; o Brave recusa sozinho e não mostra o banner.',
    'Com a aba Network do DevTools aberta, antes de aceitar: nenhuma requisição de Analytics, pixel ou similar.',
    `Depois de escolher, no console: window.HOCGuard.getConsent() devolve accepted_purposes e rejected_purposes (antes da escolha, null). A escolha fica no localStorage e no cookie hoc_guard_${id}, que é necessário: liste-o na política de cookies.`,
  ];
}

// Instalações feitas por versões antigas do guard-mcp usavam <Script> de
// next/script com beforeInteractive, que carrega depois dos rastreadores.
export function installedWithNextScript(files: { content: string }[]): boolean {
  return files.some((f) => /sdk\/banner\.js/.test(f.content) && /from\s+['"]next\/script['"]/.test(f.content) && /<Script[\s\S]{0,400}?sdk\/banner\.js|sdk\/banner\.js[\s\S]{0,400}?<\/Script>|sdk\/banner\.js[\s\S]{0,200}?strategy=/.test(f.content));
}

export interface BannerIntegration {
  mode: IntegrationMode;
  files: GeneratedFile[];
  purposes: string[];
  warnings: string[];
  /** Hguard-2581: cuidados e conferência do guia de instalação. */
  cautions: string[];
  verify: string[];
}

export function buildBannerIntegration(plan: BannerPlan): BannerIntegration {
  const warnings: string[] = [];

  // Idempotência (cenário 4): já tem o banner.js, não gera de novo.
  if (plan.alreadyInstalled) {
    if (plan.installedWithNextScript) {
      warnings.push('O banner.js está instalado com <Script> de next/script. Troque por um <script> comum como primeiro filho de <head> (veja changes), sem async nem defer: com next/script ele carrega depois dos rastreadores.');
      return {
        mode: 'already-installed',
        files: plan.framework && plan.framework !== 'nextjs' && plan.framework !== 'unknown' ? [] : [layoutFile(plan)],
        purposes: ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))],
        warnings,
        cautions: installCautions(plan),
        verify: installVerify(plan),
      };
    }
    return {
      mode: 'already-installed',
      files: [],
      purposes: ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))],
      warnings: ['O banner.js do HOC Guard já está no projeto. Não gerei nada para não duplicar. Rode guard_check_compliance para conferir se está bloqueando os rastreadores.'],
      cautions: [],
      verify: installVerify(plan),
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
    return { mode: 'notice', files: [noticeFile()], purposes: ['necessary'], warnings, cautions: [], verify: [] };
  }

  const layout = naoNext ? genericScriptFile(plan) : layoutFile(plan);
  const files = [layout, ...plan.trackers.flatMap(trackerFix)];
  const purposes = ['necessary', ...new Set(plan.trackers.map((t) => t.purpose))];
  if (!plan.bannerId) {
    warnings.push(
      `Sem banner_id: chame guard_create_banner com a URL do site para criar um sem conta, ou troque ${PLACEHOLDER_ID} pelo id de um banner do painel do HOC Guard.`,
    );
  }
  if (naoNext) {
    warnings.push(`Framework detectado: ${framework}. Gerei a integração genérica por <script>; ajuste o local no HTML raiz do seu framework.`);
  } else if (plan.router === 'unknown') {
    warnings.push('Não achei app/layout nem pages/_document; assumi App Router. Confirme onde fica o layout raiz.');
  }
  return { mode: 'consent-gate', files, purposes, warnings, cautions: installCautions(plan), verify: installVerify(plan) };
}

function indent(block: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return block.split('\n').map((l) => pad + l).join('\n');
}

// Detecta se o banner.js do HOC Guard já está no projeto (cenário 4).
export function bannerInstalled(files: { content: string }[]): boolean {
  return files.some((f) => /sdk\/banner\.js|data-banner-id|HOCGuardSettings/.test(f.content));
}
