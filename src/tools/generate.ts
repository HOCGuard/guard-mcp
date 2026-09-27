import * as z from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { detectRouter, detectTrackers, type SourceFile } from '../generate/trackers.ts';
import { buildBannerIntegration } from '../generate/banner.ts';

const SOURCE_EXT = /\.(t|j)sx?$|\.html?$|\.mdx?$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage']);
const MAX_FILES = 2000;

async function collect(root: string): Promise<SourceFile[]> {
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

export function registerGenerateTools(server: McpServer, sdkUrl: string): void {
  server.registerTool(
    'guard_generate_cookie_banner',
    {
      description:
        'Gera o banner de cookies do HOC Guard para um projeto Next.js, conforme a LGPD. Lê o código localmente (nada sai da máquina), detecta os rastreadores que o app usa (Google Analytics, GTM, Meta Pixel, Hotjar, Clarity e outros) e devolve o código para carregar o banner.js antes de tudo e bloquear cada rastreador até o consentimento. Informe project_path com a raiz do projeto, ou files com o conteúdo quando o código ainda não está salvo. Não altera arquivos: aplique as mudanças devolvidas.',
      inputSchema: z.object({
        project_path: z.string().min(1).optional(),
        files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
        banner_id: z.string().min(1).optional(),
      }),
      annotations: {
        title: 'Gerar banner de cookies',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_path, files, banner_id }) => {
      if (!project_path && !files?.length) {
        return { content: [{ type: 'text' as const, text: 'Informe project_path ou files.' }], isError: true as const };
      }
      try {
        const sources = files?.length ? files : await collect(project_path!);
        const trackers = detectTrackers(sources);
        const router = detectRouter(sources);
        const result = buildBannerIntegration({ router, bannerId: banner_id ?? null, sdkUrl, trackers });
        const payload = {
          framework: 'nextjs',
          router,
          trackers: trackers.map(({ provider, purpose, files }) => ({ provider, purpose, files })),
          purposes: result.purposes,
          changes: result.files,
          warnings: result.warnings,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Não consegui ler o projeto: ${String(error)}` }], isError: true as const };
      }
    },
  );
}
