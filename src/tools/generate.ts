import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { detectRouter, detectTrackers } from '../generate/trackers.ts';
import { buildBannerIntegration, bannerInstalled } from '../generate/banner.ts';
import { loadSources } from '../generate/collect.ts';
import { detectFramework } from '../generate/framework.ts';

export function registerGenerateTools(server: McpServer, sdkUrl: string): void {
  server.registerTool(
    'guard_generate_cookie_banner',
    {
      description:
        'Gera a conformidade de cookies do HOC Guard para um projeto Next.js, conforme a LGPD. Lê o código localmente (nada sai da máquina) e detecta os rastreadores (Google Analytics, GTM, Meta Pixel, Hotjar, Clarity e outros). Se houver rastreador não essencial, devolve o banner de consentimento que carrega o banner.js antes de tudo e bloqueia cada tracker até o aceite (mode consent-gate). Se só houver cookies essenciais, devolve um aviso informativo com link para a política, sem parede de consentimento (mode notice), porque a LGPD exige transparência mas não consentimento nesse caso. Informe project_path com a raiz do projeto, ou files com o conteúdo quando o código ainda não está salvo. Não altera arquivos: aplique as mudanças devolvidas.',
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
        const { files: sources, truncated } = await loadSources(project_path, files);
        const trackers = detectTrackers(sources);
        const router = detectRouter(sources);
        const framework = detectFramework(sources);
        const alreadyInstalled = bannerInstalled(sources);
        const result = buildBannerIntegration({ router, bannerId: banner_id ?? null, sdkUrl, trackers, framework, alreadyInstalled });
        const warnings = [...result.warnings];
        if (truncated) warnings.push('Projeto grande: li os primeiros 2000 arquivos (diretórios app/src/pages/components primeiro). Confirme que o layout raiz foi incluído.');
        const payload = {
          framework,
          mode: result.mode,
          router,
          trackers: trackers.map(({ provider, purpose, files }) => ({ provider, purpose, files })),
          purposes: result.purposes,
          changes: result.files,
          warnings,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Não consegui ler o projeto: ${String(error)}` }], isError: true as const };
      }
    },
  );
}
