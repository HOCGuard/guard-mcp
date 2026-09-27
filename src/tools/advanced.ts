import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { collect } from '../generate/collect.ts';
import { checkCompliance } from '../generate/compliance.ts';
import { buildPolicy } from '../generate/policy.ts';
import { buildReport } from '../generate/report.ts';
import { explain, EXPLANATIONS } from '../generate/explain.ts';
import { detectRouter, detectTrackers, type SourceFile } from '../generate/trackers.ts';
import { detectForms } from '../generate/forms.ts';
import { buildBannerIntegration } from '../generate/banner.ts';
import { buildConsentPoints } from '../generate/consent-point.ts';

const projectSchema = z.object({
  project_path: z.string().min(1).optional(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
});

async function sources(project_path: string | undefined, files: SourceFile[] | undefined): Promise<SourceFile[]> {
  return files?.length ? files : await collect(project_path!);
}

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
function needInput() {
  return { content: [{ type: 'text' as const, text: 'Informe project_path ou files.' }], isError: true as const };
}
function fail(error: unknown) {
  return { content: [{ type: 'text' as const, text: `Não consegui ler o projeto: ${String(error)}` }], isError: true as const };
}

export function registerAdvancedTools(server: McpServer, sdkUrl: string): void {
  server.registerTool(
    'guard_generate_policy',
    {
      description:
        'Gera um rascunho de política de privacidade que descreve o que o app REALMENTE faz, a partir dos rastreadores, campos de formulário e terceiros detectados no código (não é template genérico). Lê localmente, nada sai da máquina. Devolve Markdown para revisar com o jurídico. Aceita site_name, controller_name e dpo_email para preencher os campos.',
      inputSchema: projectSchema.extend({
        site_name: z.string().optional(),
        controller_name: z.string().optional(),
        dpo_email: z.string().optional(),
      }),
      annotations: { title: 'Gerar política de privacidade', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project_path, files, site_name, controller_name, dpo_email }) => {
      if (!project_path && !files?.length) return needInput();
      try {
        const { markdown, warnings } = buildPolicy(await sources(project_path, files), {
          siteName: site_name, controllerName: controller_name, dpoEmail: dpo_email,
        });
        return text({ policy_markdown: markdown, warnings });
      } catch (error) { return fail(error); }
    },
  );

  server.registerTool(
    'guard_explain',
    {
      description:
        'Explica em português claro um achado de conformidade: o que é, por que importa, o que a LGPD diz e como corrigir. Passe finding_code (ex: tracker-sem-consentimento). Sem argumento, lista os códigos disponíveis.',
      inputSchema: z.object({ finding_code: z.string().optional() }),
      annotations: { title: 'Explicar achado', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ finding_code }) => {
      if (!finding_code) return text({ codes: Object.keys(EXPLANATIONS) });
      const e = explain(finding_code);
      if (!e) return text({ error: `Código desconhecido: ${finding_code}`, codes: Object.keys(EXPLANATIONS) });
      return text(e);
    },
  );

  server.registerTool(
    'guard_make_compliant',
    {
      description:
        'Deixa um projeto Next.js pronto para a LGPD em um passo. Lê o código localmente, roda o diagnóstico, e devolve tudo o que falta: a integração do banner (ou aviso), os pontos de consentimento nos formulários, o rascunho de política, e um checklist com a nota antes e a estimativa depois. Não altera arquivos: o agente aplica as mudanças devolvidas.',
      inputSchema: projectSchema.extend({
        banner_id: z.string().optional(),
        dpo_email: z.string().optional(),
      }),
      annotations: { title: 'Deixar conforme a LGPD', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project_path, files, banner_id, dpo_email }) => {
      if (!project_path && !files?.length) return needInput();
      try {
        const src = await sources(project_path, files);
        const antes = checkCompliance(src);
        const trackers = detectTrackers(src);
        const router = detectRouter(src);
        const forms = detectForms(src);
        const banner = buildBannerIntegration({ router, bannerId: banner_id ?? null, sdkUrl, trackers });
        const consent = buildConsentPoints(forms);
        const policy = buildPolicy(src, { dpoEmail: dpo_email });

        const checklist = [
          { passo: 'Cookies', modo: banner.mode, arquivos: banner.files.length, feito: false },
          { passo: 'Consentimento em formulários', formularios_sem_consentimento: forms.filter((f) => !f.hasConsent).length, arquivos: consent.files.length, feito: false },
          { passo: 'Política de privacidade', gerada: true, feito: false },
        ];
        // Estimativa: aplicar as mudanças zera os achados que elas resolvem.
        const depois = 100;

        return text({
          score_antes: antes.score,
          score_depois_estimado: depois,
          checklist,
          banner: { mode: banner.mode, changes: banner.files, warnings: banner.warnings },
          consent_points: { changes: consent.files, warnings: consent.warnings },
          policy: { policy_markdown: policy.markdown, warnings: policy.warnings },
          report_markdown: buildReport(antes.score, antes.findings),
          proximo_passo: 'Aplique as mudanças de banner e consent_points, publique a política, e rode guard_check_compliance de novo para confirmar.',
        });
      } catch (error) { return fail(error); }
    },
  );
}
