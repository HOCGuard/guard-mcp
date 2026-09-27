import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SourceFile } from './trackers.ts';

const SOURCE_EXT = /\.(t|j)sx?$|\.html?$|\.mdx?$|\.vue$|\.svelte$|\.astro$/;
// Arquivos de manifesto/config que ajudam a detectar framework e dependências.
const EXTRA_FILES = /(^|\/)(package\.json|next\.config\.[mc]?[jt]s|vite\.config\.[mc]?[jt]s|astro\.config\.[mc]?[jt]s)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel']);
// Diretórios que quase sempre têm o que interessa. Visitados primeiro para não
// perder o essencial quando o teto é atingido em monorepo grande (cenário 5).
const PRIORITY = ['app', 'src', 'pages', 'components'];
const MAX_FILES = 2000;

export interface Collected {
  files: SourceFile[];
  truncated: boolean;
}

// Lê o projeto do disco para análise estática. Nada sai da máquina.
export async function collect(root: string): Promise<Collected> {
  const files: SourceFile[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    // Prioriza diretórios importantes antes dos demais.
    entries.sort((a, b) => {
      const pa = PRIORITY.includes(a.name) ? 0 : 1;
      const pb = PRIORITY.includes(b.name) ? 0 : 1;
      return pa - pb;
    });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else {
        const rel = relative(root, full).replace(/\\/g, '/');
        if (SOURCE_EXT.test(entry.name) || EXTRA_FILES.test(rel)) {
          files.push({ path: rel, content: await readFile(full, 'utf8') });
        }
      }
    }
  }
  await walk(root);
  return { files, truncated };
}

// Resolve as fontes a partir de project_path (lê do disco) ou files (inline).
export async function loadSources(
  project_path: string | undefined,
  files: SourceFile[] | undefined,
): Promise<Collected> {
  if (files?.length) return { files, truncated: false };
  return collect(project_path!);
}
