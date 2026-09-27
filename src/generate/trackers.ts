// Detecção local de rastreadores no código do projeto. Nada sai da máquina:
// o gerador lê os arquivos, casa padrões conhecidos e devolve o que achou.
// Categorias seguem a taxonomia do provider-catalog do hoc-mod-gcc.

export type Purpose = 'necessary' | 'functional' | 'analytics' | 'marketing';

export interface TrackerRule {
  id: string;
  provider: string;
  purpose: Purpose;
  // Tags do Google respeitam o Consent Mode v2 que o banner.js instala; as
  // demais precisam ser bloqueadas até o consentimento.
  consentMode: boolean;
  patterns: RegExp[];
}

export const TRACKER_RULES: TrackerRule[] = [
  {
    id: 'google-analytics',
    provider: 'Google Analytics',
    purpose: 'analytics',
    consentMode: true,
    patterns: [/googletagmanager\.com\/gtag\/js/, /\bgtag\(\s*['"]config['"]/, /<GoogleAnalytics\b/, /react-ga4?/],
  },
  {
    id: 'google-tag-manager',
    provider: 'Google Tag Manager',
    purpose: 'analytics',
    consentMode: true,
    patterns: [/googletagmanager\.com\/gtm\.js/, /<GoogleTagManager\b/, /react-gtm-module/],
  },
  {
    id: 'meta-pixel',
    provider: 'Meta Pixel',
    purpose: 'marketing',
    consentMode: false,
    patterns: [/connect\.facebook\.net\/[^'"]*fbevents\.js/, /\bfbq\(\s*['"]init['"]/, /react-facebook-pixel/],
  },
  {
    id: 'tiktok-pixel',
    provider: 'TikTok Pixel',
    purpose: 'marketing',
    consentMode: false,
    patterns: [/analytics\.tiktok\.com/, /\bttq\.load\(/],
  },
  {
    id: 'linkedin-insight',
    provider: 'LinkedIn Insight Tag',
    purpose: 'marketing',
    consentMode: false,
    patterns: [/snap\.licdn\.com/, /_linkedin_partner_id/],
  },
  {
    id: 'hotjar',
    provider: 'Hotjar',
    purpose: 'analytics',
    consentMode: false,
    patterns: [/static\.hotjar\.com/, /@hotjar\/browser/],
  },
  {
    id: 'microsoft-clarity',
    provider: 'Microsoft Clarity',
    purpose: 'analytics',
    consentMode: false,
    patterns: [/clarity\.ms\/tag/, /@microsoft\/clarity/],
  },
  {
    id: 'vercel-analytics',
    provider: 'Vercel Analytics',
    purpose: 'analytics',
    consentMode: false,
    patterns: [/@vercel\/analytics/],
  },
];

export interface SourceFile {
  path: string;
  content: string;
}

export interface DetectedTracker {
  id: string;
  provider: string;
  purpose: Purpose;
  consentMode: boolean;
  files: string[];
}

export function detectTrackers(files: SourceFile[]): DetectedTracker[] {
  const found = new Map<string, DetectedTracker>();
  for (const file of files) {
    for (const rule of TRACKER_RULES) {
      if (!rule.patterns.some((p) => p.test(file.content))) continue;
      const entry = found.get(rule.id) ?? {
        id: rule.id,
        provider: rule.provider,
        purpose: rule.purpose,
        consentMode: rule.consentMode,
        files: [],
      };
      if (!entry.files.includes(file.path)) entry.files.push(file.path);
      found.set(rule.id, entry);
    }
  }
  return [...found.values()];
}

export type Router = 'app' | 'pages' | 'unknown';

export function detectRouter(files: SourceFile[]): Router {
  const paths = files.map((f) => f.path.replace(/\\/g, '/'));
  if (paths.some((p) => /(^|\/)app\/layout\.(t|j)sx?$/.test(p))) return 'app';
  if (paths.some((p) => /(^|\/)pages\/_(app|document)\.(t|j)sx?$/.test(p))) return 'pages';
  return 'unknown';
}
