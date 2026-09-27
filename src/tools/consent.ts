import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { loadSources } from '../generate/collect.ts';
import { detectForms } from '../generate/forms.ts';
import { buildConsentPoints } from '../generate/consent-point.ts';
import { checkCompliance } from '../generate/compliance.ts';
import { buildReport } from '../generate/report.ts';

const inputSchema = z.object({
  project_path: z.string().min(1).optional(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
});

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function needInput() {
  return { content: [{ type: 'text' as const, text: 'Informe project_path ou files.' }], isError: true as const };
}

export function registerConsentTools(server: McpServer): void {
  server.registerTool(
    'guard_add_consent_point',
    {
      description:
        'Adiciona o ponto de coleta de consentimento (LGPD) aos formulários de um projeto Next.js que coletam dado pessoal (e-mail, telefone, CPF, nome). Lê o código localmente (nada sai da máquina), acha os formulários sem consentimento e devolve um componente ConsentField (checkbox com base legal e link de política) mais onde inseri-lo. Não altera arquivos: aplique as mudanças devolvidas.',
      inputSchema,
      annotations: {
        title: 'Adicionar ponto de consentimento',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_path, files }) => {
      if (!project_path && !files?.length) return needInput();
      try {
        const { files: src } = await loadSources(project_path, files);
        const forms = detectForms(src);
        const result = buildConsentPoints(forms);
        return text({
          forms: forms.map(({ path, fields, hasConsent }) => ({ path, fields, hasConsent })),
          changes: result.files,
          warnings: result.warnings,
        });
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Não consegui ler o projeto: ${String(error)}` }], isError: true as const };
      }
    },
  );

  server.registerTool(
    'guard_check_compliance',
    {
      description:
        'Diagnóstico local de conformidade LGPD de um projeto. Lê o código (nada sai da máquina) e aponta problemas: rastreador não essencial que pode disparar sem consentimento, formulário que coleta dado pessoal sem consentimento, e falta de link para a política de privacidade. Devolve os achados ordenados por gravidade e uma nota de 0 a 100. Não roda no site publicado (para isso use guard_scan_site); é uma checagem estática do código.',
      inputSchema,
      annotations: {
        title: 'Checar conformidade (local)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_path, files }) => {
      if (!project_path && !files?.length) return needInput();
      try {
        const { files: src } = await loadSources(project_path, files);
        const { findings, score, metodo } = checkCompliance(src);
        return text({ score, metodo, total: findings.length, findings, report_markdown: buildReport(score, findings) });
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Não consegui ler o projeto: ${String(error)}` }], isError: true as const };
      }
    },
  );
}
