import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { BannerApiError, BannerStore, createAnonymousBanner, normalizeOrigin } from '../banner-client.ts';
import { loadSources } from '../generate/collect.ts';
import { detectTrackers } from '../generate/trackers.ts';

export interface BannerToolDeps {
  apiOrigin: string;
  homeDir: string;
  version: string;
}

export function registerBannerTools(server: McpServer, deps: BannerToolDeps): void {
  const store = new BannerStore(deps.homeDir);

  server.registerTool(
    'guard_create_banner',
    {
      description:
        'Cria o banner de cookies do HOC Guard para um site, sem precisar de conta, e devolve o banner_id para usar em guard_generate_cookie_banner ou guard_make_compliant. As finalidades vêm dos rastreadores detectados no projeto (project_path ou files), ou de purposes. Se já existe um banner criado nesta máquina para o mesmo site, devolve o mesmo, sem duplicar. O banner pode ser reivindicado depois ao criar a conta grátis. Não envia código: só a origem do site, as finalidades e os nomes dos serviços detectados.',
      inputSchema: z.object({
        site_url: z.string().min(3).describe('URL ou domínio do site, ex: https://meusite.com.br'),
        project_path: z.string().min(1).optional(),
        files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
        purposes: z.array(z.enum(['analytics', 'marketing', 'functional'])).optional(),
        locale: z.string().default('pt-BR'),
      }),
      annotations: { title: 'Criar banner (sem conta)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ site_url, project_path, files, purposes, locale }) => {
      let origin: string;
      try {
        origin = normalizeOrigin(site_url);
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `URL inválida: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const };
      }

      const existente = await store.find(origin);
      if (existente) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ banner_id: existente.banner_id, site_origin: origin, reused: true, next: `Use banner_id ${existente.banner_id} em guard_generate_cookie_banner.` }) }] };
      }

      let providers: string[] = [];
      let finalidades = purposes ?? [];
      if (project_path || files?.length) {
        const { files: src } = await loadSources(project_path, files);
        const trackers = detectTrackers(src);
        providers = trackers.map((t) => t.provider);
        if (!purposes) finalidades = [...new Set(trackers.map((t) => t.purpose).filter((p) => p !== 'necessary'))];
      }

      try {
        const created = await createAnonymousBanner(deps.apiOrigin, {
          site_origin: origin,
          purposes: ['necessary', ...finalidades],
          providers,
          locale,
          client_version: deps.version,
        });
        await store.save({ banner_id: created.banner_id, site_origin: origin, claim_token: created.claim_token, created_at: new Date().toISOString(), expires_at: created.expires_at });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              banner_id: created.banner_id,
              site_origin: origin,
              purposes: ['necessary', ...finalidades],
              reused: false,
              expires_at: created.expires_at,
              claim: 'O comprovante de posse ficou salvo só nesta máquina (~/.hocguard/banners.json). Ao criar a conta grátis e fazer login, o banner passa para a sua conta.',
              next: `Chame guard_generate_cookie_banner com banner_id ${created.banner_id}.`,
            }),
          }],
        };
      } catch (error) {
        const msg = error instanceof BannerApiError ? error.message : `Falha inesperada: ${String(error)}`;
        return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
      }
    },
  );
}
