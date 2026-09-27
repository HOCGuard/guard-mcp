import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { SECURE_SHIP_DESCRIPTION, SECURE_SHIP_STEPS } from '../workflow.ts';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'guard-secure-ship',
    {
      title: 'Deixar o projeto conforme a LGPD',
      description: SECURE_SHIP_DESCRIPTION,
      argsSchema: z.object({
        project_path: z.string().optional().describe('Raiz do projeto. Padrão: diretório atual.'),
      }),
    },
    ({ project_path }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `${SECURE_SHIP_STEPS}\n\nProjeto: ${project_path ?? 'o diretório atual do workspace'}.`,
          },
        },
      ],
    }),
  );
}
