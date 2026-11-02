import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { AuditorClient, AuditorError } from '../auditor-client.ts';
import { summarize } from '../findings.ts';
import { explainFailure, failureMessage } from '../scan-failure.ts';
import { GCC_SCAN_PREFIX, summarizeGccReport } from '../gcc-report.ts';

const FRAMEWORKS = ['lgpd', 'gdpr', 'ccpa', 'all'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

// Hguard-2583: saída estruturada nas leituras de varredura. O texto continua
// igual (JSON serializado) para cliente que não lê structuredContent.
function structured<T extends Record<string, unknown>>(payload: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

const statusOutput = z.object({
  scan_id: z.string(),
  status: z.string(),
  elapsed_seconds: z.number().optional(),
  ready: z.boolean(),
  link: z.string().optional(),
  reason: z.string().optional(),
  motivo: z.string().optional(),
  next: z.string().optional(),
  retry_helps: z.boolean().optional(),
});

// Mesma forma para o resultado do auditor e o do relatório do Guard (Hguard-2582).
const resultsOutput = z.object({
  url: z.string().optional(),
  verdict: z.enum(['confirmado', 'preliminar', 'nao_vimos_o_site']),
  verdict_note: z.string(),
  grade: z.string().optional(),
  score: z.number().optional(),
  coverage: z.number().optional(),
  link: z.string().optional(),
  pillars: z.array(z.object({ id: z.string(), grade: z.string().optional(), problems: z.number().optional() })).optional(),
  not_measured: z.array(z.object({ phase: z.string(), reason: z.string().optional() })).optional(),
  counts: z.record(z.string(), z.number()),
  findings: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['check', 'dark_pattern', 'achado', 'pergunta']),
    severity: z.enum(SEVERITIES).optional(),
    priority: z.enum(['corrigir', 'melhorar']).optional(),
    action: z.string().optional(),
    detail: z.string().optional(),
    uncertain: z.literal(true).optional(),
  })),
  passed: z.array(z.string()).optional(),
  truncated: z.number().optional(),
});

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
          ...(started.link ? { link: started.link } : {}),
          next: started.link
            ? 'Chame guard_get_scan_status com este scan_id. Quando status for completed, chame guard_get_scan_results. A análise também aparece em Sites, no link.'
            : 'Chame guard_get_scan_status com este scan_id. Quando status for completed, chame guard_get_scan_results.',
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
        'Informa em que pé está uma varredura iniciada por guard_scan_site. Responde queued, running, retrying, completed ou failed. Em failed traz o motivo e o próximo passo: não chame guard_get_scan_results nem repita a consulta. Espere alguns segundos entre consultas.',
      inputSchema: z.object({ scan_id: z.string().min(1) }),
      outputSchema: statusOutput,
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
        const base = {
          scan_id: status.job_id,
          status: status.status,
          elapsed_seconds: status.elapsed_ms ? Math.round(status.elapsed_ms / 1000) : undefined,
          ready: status.status === 'completed',
          ...(status.link ? { link: status.link } : {}),
        };
        if (status.status !== 'failed') return structured(base);
        // Hguard-2578: sem o motivo o agente ficava consultando em loop.
        const e = explainFailure(status.failure);
        return structured({ ...base, reason: e.reason, motivo: e.motivo, next: e.next, retry_helps: e.retry });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_get_scan_results',
    {
      description:
        'Devolve os achados de uma varredura concluída, do mais grave para o menos grave. Leia verdict antes da nota: confirmado é resultado medido; preliminar tem item importante não confirmado (nota provisória); nao_vimos_o_site não tem nota e não atesta nada. Repasse verdict_note ao usuário. Traz só o que precisa de atenção; passe include_passed para ver também o que está correto.',
      inputSchema: z.object({
        scan_id: z.string().min(1),
        include_passed: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(40),
      }),
      outputSchema: resultsOutput,
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
        if (scan_id.startsWith(GCC_SCAN_PREFIX)) {
          // Hguard-2582: análise pelo gcc; o resultado é o relatório do Guard.
          const { rel, link } = await client.getGccReport(scan_id);
          const st = rel.analise?.status;
          if (st === 'failed') {
            const status = await client.getStatus(scan_id);
            return failure(new AuditorError(failureMessage(scan_id, status.failure)));
          }
          if (st !== 'completed') {
            return failure(new AuditorError('A varredura ainda não terminou. Consulte guard_get_scan_status e tente de novo quando estiver completed.'));
          }
          return structured({ ...summarizeGccReport(rel, link, { includePassed: include_passed, limit }) });
        }
        const report = await client.getReport(scan_id);
        return structured({ ...summarize(report, { includePassed: include_passed, limit }) });
      } catch (error) {
        if (error instanceof AuditorError && error.status === 409) {
          // 409 também vem quando o job falhou: conferir antes de mandar esperar.
          const status = await client.getStatus(scan_id).catch(() => undefined);
          if (status?.status === 'failed') return failure(new AuditorError(failureMessage(scan_id, status.failure)));
          return failure(
            new AuditorError('A varredura ainda não terminou. Consulte guard_get_scan_status e tente de novo quando estiver completed.'),
          );
        }
        return failure(error);
      }
    },
  );
}
