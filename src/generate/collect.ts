import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SourceFile } from './trackers.ts';

const SOURCE_EXT = /\.(t|j)sx?$|\.html?$|\.mdx?$|\.vue$|\.svelte$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage']);
const MAX_FILES = 2000;

// Lê o projeto do disco para análise estática. Nada sai da máquina.
export async function collect(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (SOURCE_EXT.test(entry.name)) {
        files.push({ path: relative(root, full), content: await readFile(full, 'utf8') });
      }
    }
  }
  await walk(root);
  return files;
}
