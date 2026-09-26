import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { AuditorClient, AuditorError } from '../auditor-client.ts';
import { summarize } from '../findings.ts';

const FRAMEWORKS = ['lgpd', 'gdpr', 'ccpa', 'all'] as const;

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function failure(error: unknown) {
  const message = error instanceof AuditorError ? error.message : `Falha inesperada: ${String(error)}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

export function registerScanTools(server: McpServer, client: AuditorClient): void {
  server.registerTool(
    'guard_scan_site',
    {
      description:
        'Inicia a varredura de privacidade de um site. Abre um navegador de verdade, aceita e rejeita o banner de cookies e observa o que o site faz em cada caso: se rastreador dispara antes do consentimento, se o rejeitar realmente rejeita, se há dark pattern, se a política e o canal do titular existem. Demora cerca de dois minutos, então devolve um scan_id: acompanhe com guard_get_scan_status e busque o resultado com guard_get_scan_results.',
      inputSchema: z.object({
        url: z.string().url('Informe a URL completa, com https://'),
        framework: z.enum(FRAMEWORKS).default('lgpd'),
      }),
      annotations: {
        title: 'Varrer site',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, framework }) => {
      try {
        const started = await client.startScan(url, framework);
        return text({
          scan_id: started.job_id,
          estimated_seconds: started.estimated_duration_seconds ?? 120,
          next: 'Chame guard_get_scan_status com este scan_id. Quando status for completed, chame guard_get_scan_results.',
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_get_scan_status',
    {
      description:
        'Informa em que pé está uma varredura iniciada por guard_scan_site. Responde queued, running, completed ou failed. Espere alguns segundos entre consultas.',
      inputSchema: z.object({ scan_id: z.string().min(1) }),
      annotations: {
        title: 'Status da varredura',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scan_id }) => {
      try {
        const status = await client.getStatus(scan_id);
        return text({
          scan_id: status.job_id,
          status: status.status,
          elapsed_seconds: status.elapsed_ms ? Math.round(status.elapsed_ms / 1000) : undefined,
          ready: status.status === 'completed',
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_get_scan_results',
    {
      description:
        'Devolve os achados de uma varredura concluída, do mais grave para o menos grave, com nota geral. Traz só o que precisa de atenção; passe include_passed para ver também o que está correto.',
      inputSchema: z.object({
        scan_id: z.string().min(1),
        include_passed: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(40),
      }),
      annotations: {
        title: 'Resultado da varredura',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scan_id, include_passed, limit }) => {
      try {
        const report = await client.getReport(scan_id);
        return text(summarize(report, { includePassed: include_passed, limit }));
      } catch (error) {
        if (error instanceof AuditorError && error.status === 409) {
          return failure(
            new AuditorError('A varredura ainda não terminou. Consulte guard_get_scan_status e tente de novo quando estiver completed.'),
          );
        }
        return failure(error);
      }
    },
  );
}
