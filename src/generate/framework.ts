import type { SourceFile } from './trackers.ts';

// Detecta o framework do projeto para gerar a integração certa, em vez de
// assumir Next.js e devolver código errado em silêncio (cenário 1).

export type Framework = 'nextjs' | 'vite' | 'astro' | 'remix' | 'vue' | 'html' | 'unknown';

export function detectFramework(files: SourceFile[]): Framework {
  const byPath = (re: RegExp) => files.some((f) => re.test(f.path.replace(/\\/g, '/')));
  const pkg = files.find((f) => /(^|\/)package\.json$/.test(f.path.replace(/\\/g, '/')));
  const deps = pkg ? pkg.content : '';

  if (byPath(/(^|\/)(next\.config\.(m?[jt]s|mjs))$/) || /"next"\s*:/.test(deps)) return 'nextjs';
  if (byPath(/(^|\/)astro\.config\./) || /"astro"\s*:/.test(deps)) return 'astro';
  if (/"@remix-run\//.test(deps)) return 'remix';
  if (byPath(/(^|\/)vite\.config\./) || /"vite"\s*:/.test(deps)) return 'vite';
  if (byPath(/\.vue$/) || /"vue"\s*:/.test(deps)) return 'vue';
  if (byPath(/(^|\/)index\.html$/)) return 'html';
  return 'unknown';
}
