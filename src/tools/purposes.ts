import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.ts';
import {
  PurposesClient,
  PurposesError,
  type Lia,
  type PurposeStudio,
  type PurposeVersion,
  type StudioContext,
} from '../purposes-client.ts';
import { GUARD_MCP_CLIENT_ID } from '../auth/device-flow.ts';

// Finalidades na conta do Guard. O agente consulta, cria e edita RASCUNHOS; quem
// libera (publica) é sempre a pessoa, na tela. Nenhuma ferramenta daqui chama
// /publish.

const LEGAL_BASES = ['consent', 'legitimate_interest', 'contract', 'legal_obligation'] as const;
const LIA_CONCLUSIONS = ['favoravel', 'favoravel_com_salvaguardas', 'desfavoravel'] as const;

const BASIS_LABEL: Record<string, string> = {
  consent: 'Consentimento',
  legitimate_interest: 'Legítimo interesse',
  contract: 'Execução de contrato',
  legal_obligation: 'Obrigação legal',
};

const LIBERAR =
  'Isto é um rascunho: nada muda para os titulares até a pessoa revisar e clicar em Liberar na tela do Guard. Mostre o link ao usuário. O agente não publica.';

const DEFAULT_AGENTE = 'Agente de IA (HOC Guard MCP)';

function otherDraftMessage(link: string): string {
  return `Já existe um rascunho aberto por uma pessoa (na tela do Guard ou por outro agente) nesta finalidade. O agente não mexe nele nem abre outro: peça para a pessoa liberar ou descartar esse rascunho antes. ${link}`;
}

// Proposta deste client (guard-mcp). Se é da mesma pessoa, só o gcc sabe: ele
// responde 403 purpose-version-not-own-proposal quando não é.
function isOwnClientProposal(v: PurposeVersion): boolean {
  return (v.config?.proposta as { cliente?: unknown } | null | undefined)?.cliente === GUARD_MCP_CLIENT_ID;
}

function notOwnCancelMessage(link: string): string {
  return `Esse rascunho não foi proposto por você (foi aberto na tela, por outra pessoa ou por outro agente). O agente só cancela a própria proposta; quem quiser descartar esse rascunho faz isso na tela do Guard: ${link}`;
}

const NOT_OWN = new Set(['purpose-has-other-draft', 'purpose-version-not-own-proposal']);

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function failure(error: unknown) {
  const message = error instanceof PurposesError ? error.message : `Falha inesperada: ${String(error)}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function blank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === '';
}

export interface RuleInput {
  basis: string | null | undefined;
  sensitive: boolean | undefined;
  lia: Lia | undefined;
}

// Mesmas regras que o gcc aplica, checadas antes de chamar a API para o agente
// receber a explicação completa de uma vez.
export function validatePurposeRules({ basis, sensitive, lia }: RuleInput): string[] {
  if (basis !== 'legitimate_interest') return [];
  if (sensitive) {
    return [
      'Legítimo interesse não pode ser usado com dado pessoal sensível (a LGPD, art. 11, não prevê essa base para dado sensível). Use consentimento (legal_basis "consent") ou outra base do art. 11.',
    ];
  }
  const problems: string[] = [];
  const faltando = [
    blank(lia?.interest) ? 'lia_interest (fase 1: qual é o interesse legítimo e de quem)' : null,
    blank(lia?.necessity) ? 'lia_necessity (fase 2: por que o tratamento é necessário e não há meio menos invasivo)' : null,
    blank(lia?.balance) ? 'lia_balance (fase 3: balanceamento com as expectativas e direitos da pessoa)' : null,
  ].filter((v): v is string => v !== null);
  if (faltando.length) problems.push(`Legítimo interesse exige o teste nas 3 fases. Falta: ${faltando.join('; ')}.`);
  if (blank(lia?.opt_out)) problems.push('Legítimo interesse exige que a pessoa possa se opor: descreva como em lia_opt_out.');
  if (lia?.conclusion === 'desfavoravel') {
    problems.push('O teste de legítimo interesse concluiu desfavorável: essa base não pode ser usada. Escolha outra base legal (em geral, consentimento).');
  }
  return problems;
}

function rulesFailure(problems: string[]) {
  return {
    content: [{ type: 'text' as const, text: `Não enviei ao Guard porque a finalidade não passa nas regras:\n- ${problems.join('\n- ')}` }],
    isError: true as const,
  };
}

function readableContext(c: StudioContext) {
  return {
    lei: c.law === 'eu' ? 'GDPR (UE)' : c.law === 'br' ? 'LGPD (Brasil)' : c.law,
    base_legal: c.basis ? (BASIS_LABEL[c.basis] ?? c.basis) : null,
    escopo: c.scope ?? null,
    justificativa: c.rationale ?? null,
    retencao: c.retention ?? null,
    retencao_conta_a_partir_de: c.starts ?? null,
    pontos_de_coleta: c.points ?? null,
    dado_sensivel: c.sensitive ?? false,
    menores: c.minors ?? false,
    ...(c.lia
      ? {
          teste_legitimo_interesse: {
            interesse: c.lia.interest ?? null,
            necessidade: c.lia.necessity ?? null,
            balanceamento: c.lia.balance ?? null,
            salvaguardas: c.lia.safeguards ?? null,
            como_se_opor: c.lia.opt_out ?? null,
            conclusao: c.lia.conclusion ?? null,
          },
        }
      : {}),
  };
}

function readableVersion(v: PurposeVersion) {
  const s = v.config?.purpose_studio;
  return {
    versao_id: v.id,
    numero: v.version_number ?? null,
    status: v.status === 'draft' ? 'rascunho' : v.status === 'published' ? 'publicada' : 'substituída',
    titulo: s?.title ?? null,
    uso: s?.description ?? null,
    texto_para_a_pessoa: v.consent_text ?? s?.text ?? null,
    base_legal: v.legal_basis ? (BASIS_LABEL[v.legal_basis] ?? v.legal_basis) : null,
    retencao_dias: v.retention_days ?? null,
    identificador_do_titular: v.grouping_identifier ?? s?.identifier ?? null,
    contextos: (s?.contexts ?? []).map(readableContext),
    proposta_de_agente: v.config?.proposta ?? null,
    publicada_em: v.published_at ?? null,
  };
}

function pendencias(v: PurposeVersion): string[] {
  const out: string[] = [];
  const ctxs = v.config?.purpose_studio?.contexts ?? [];
  if (v.retention_days == null && !ctxs.some((c) => c.retention != null && c.retention !== '')) out.push('Retenção não definida: diga por quanto tempo o dado é guardado.');
  if (blank(v.consent_text ?? v.config?.purpose_studio?.text)) out.push('Texto para a pessoa está vazio.');
  if (ctxs.length === 0) out.push('Nenhum contexto de lei (LGPD/GDPR) com base legal e justificativa.');
  for (const c of ctxs) {
    const onde = c.law ? ` (${c.law})` : '';
    if (blank(c.rationale)) out.push(`Justificativa da base legal vazia${onde}.`);
    for (const p of validatePurposeRules({ basis: c.basis ?? v.legal_basis, sensitive: c.sensitive, lia: c.lia })) out.push(`${p}${onde}`);
  }
  return out;
}

const liaFields = {
  lia_interest: z.string().max(2000).optional().describe('Legítimo interesse, fase 1: qual é o interesse e de quem.'),
  lia_necessity: z.string().max(2000).optional().describe('Fase 2: por que é necessário e não há meio menos invasivo.'),
  lia_balance: z.string().max(2000).optional().describe('Fase 3: balanceamento com as expectativas e direitos da pessoa.'),
  lia_safeguards: z.string().max(2000).optional().describe('Salvaguardas adotadas (minimização, pseudonimização, prazo curto).'),
  lia_opt_out: z.string().max(2000).optional().describe('Como a pessoa se opõe ao tratamento. Obrigatório com legítimo interesse.'),
  lia_conclusion: z.enum(LIA_CONCLUSIONS).optional().describe('Conclusão do teste de legítimo interesse.'),
};

const contextFields = {
  law: z.enum(['br', 'eu']).optional().describe('Lei do contexto: br (LGPD) ou eu (GDPR). Padrão: br.'),
  scope: z.string().max(1200).optional().describe('Escopo: quem são os titulares e onde o dado é coletado.'),
  rationale: z.string().max(2400).optional().describe('Justificativa da base legal escolhida.'),
  retention_days: z.number().int().min(1).max(36500).optional().describe('Por quantos dias o dado é guardado.'),
  retention_starts: z.string().max(200).optional().describe('A partir de quando a retenção conta (ex: fim do contrato, último acesso).'),
  sensitive: z.boolean().optional().describe('Envolve dado pessoal sensível (saúde, biometria, religião, origem racial etc).'),
  minors: z.boolean().optional().describe('Envolve dado de criança ou adolescente.'),
  ...liaFields,
};

const agenteField = z.string().min(1).max(60).optional().describe('Nome do agente, aparece para a pessoa na proposta. Ex: "Claude Code".');

type LiaInput = { [K in keyof typeof liaFields]?: string | undefined };

function liaFrom(input: LiaInput): Lia {
  const lia: Lia = {};
  if (input.lia_interest !== undefined) lia.interest = input.lia_interest;
  if (input.lia_necessity !== undefined) lia.necessity = input.lia_necessity;
  if (input.lia_balance !== undefined) lia.balance = input.lia_balance;
  if (input.lia_safeguards !== undefined) lia.safeguards = input.lia_safeguards;
  if (input.lia_opt_out !== undefined) lia.opt_out = input.lia_opt_out;
  if (input.lia_conclusion !== undefined) lia.conclusion = input.lia_conclusion;
  return lia;
}

function defined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export interface UpdateInput extends LiaInput {
  title?: string | undefined;
  description?: string | undefined;
  consent_text?: string | undefined;
  legal_basis?: string | undefined;
  law?: string | undefined;
  scope?: string | undefined;
  rationale?: string | undefined;
  retention_days?: number | undefined;
  retention_starts?: string | undefined;
  grouping_identifier?: string | undefined;
  sensitive?: boolean | undefined;
  minors?: boolean | undefined;
}

// Mescla o que o agente mandou no purpose_studio atual sem apagar nada que ele
// não mandou (outros contextos, pontos de coleta, campos desconhecidos).
export function mergeStudio(current: PurposeStudio | undefined, input: UpdateInput): { studio: PurposeStudio; context: StudioContext | undefined } {
  const studio: PurposeStudio = { ...(current ?? {}) };
  Object.assign(
    studio,
    defined({ title: input.title, description: input.description, text: input.consent_text, identifier: input.grouping_identifier }),
  );

  const ctxChanges = defined({
    basis: input.legal_basis,
    scope: input.scope,
    rationale: input.rationale,
    retention: input.retention_days,
    starts: input.retention_starts,
    sensitive: input.sensitive,
    minors: input.minors,
  });
  const liaChanges = liaFrom(input);
  const touchesContext = input.law !== undefined || Object.keys(ctxChanges).length > 0 || Object.keys(liaChanges).length > 0;
  const contexts = [...(current?.contexts ?? [])];
  if (!touchesContext) {
    if (current?.contexts) studio.contexts = contexts;
    return { studio, context: undefined };
  }

  let idx = input.law !== undefined ? contexts.findIndex((c) => c.law === input.law) : contexts.length > 0 ? 0 : -1;
  if (idx < 0) {
    contexts.push({ law: input.law ?? 'br' });
    idx = contexts.length - 1;
  }
  const prev = contexts[idx]!;
  const next: StudioContext = { ...prev, ...ctxChanges };
  if (Object.keys(liaChanges).length > 0) next.lia = { ...(prev.lia ?? {}), ...liaChanges };
  contexts[idx] = next;
  studio.contexts = contexts;
  return { studio, context: next };
}

export function registerPurposeTools(server: McpServer, config: Config): void {
  const client = new PurposesClient(config);

  server.registerTool(
    'guard_list_purposes',
    {
      description:
        'Lista as finalidades de tratamento de dados da conta do HOC Guard (por que a empresa usa cada dado pessoal), com o estado de cada uma: publicada, com rascunho aguardando a pessoa liberar, ou com proposta feita por agente de IA. Use antes de criar uma finalidade, para não duplicar. Exige guard_login.',
      inputSchema: z.object({
        search: z.string().max(200).optional().describe('Trecho do nome ou da descrição.'),
        status: z
          .enum(['todas', 'publicada', 'rascunho', 'proposta_de_agente'])
          .default('todas')
          .describe('publicada: tem versão no ar; rascunho: tem rascunho aguardando liberação; proposta_de_agente: o rascunho foi proposto por um agente.'),
        legal_basis: z.enum(LEGAL_BASES).optional().describe('Filtra pela base legal (publicada ou do rascunho).'),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(100).default(50),
      }),
      annotations: { title: 'Listar finalidades', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ search, status, legal_basis, page, per_page }) => {
      try {
        const res = await client.list({ page, per_page, search });
        const itens = (res.data ?? [])
          .map((p) => {
            const s = p.summary ?? {};
            return {
              id: p.id,
              nome: p.name,
              descricao: p.description ?? null,
              publicada: s.published_version != null,
              versao_publicada: s.published_version ?? null,
              base_legal_publicada: s.published_legal_basis ?? null,
              rascunho_id: s.draft_version_id ?? null,
              base_legal_rascunho: s.draft_legal_basis ?? null,
              proposta_de_agente: s.draft_proposta ?? null,
              link: client.reviewLink(p.id),
            };
          })
          .filter((p) => {
            if (status === 'publicada' && !p.publicada) return false;
            if (status === 'rascunho' && !p.rascunho_id) return false;
            if (status === 'proposta_de_agente' && !p.proposta_de_agente) return false;
            if (legal_basis && p.base_legal_publicada !== legal_basis && p.base_legal_rascunho !== legal_basis) return false;
            return true;
          });
        return text({
          total: itens.length,
          page,
          meta: res.meta ?? null,
          finalidades: itens,
          next: 'Use guard_get_purpose com o id para ver o detalhe e as pendências.',
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_get_purpose',
    {
      description:
        'Mostra uma finalidade da conta do Guard em formato legível: título, uso, texto mostrado para a pessoa, base legal, justificativa, retenção, teste de legítimo interesse, a versão publicada e o rascunho (se houver), e as pendências óbvias (retenção vazia, legítimo interesse sem teste etc). Exige guard_login.',
      inputSchema: z.object({ id: z.string().min(1).describe('Id da finalidade (de guard_list_purposes).') }),
      annotations: { title: 'Ver finalidade', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const [purpose, versions] = await Promise.all([client.get(id), client.versions(id)]);
        const published = versions.find((v) => v.status === 'published');
        const draft = versions.find((v) => v.status === 'draft');
        const atual = draft ?? published;
        const pend = atual ? pendencias(atual) : ['A finalidade não tem nenhuma versão.'];
        if (draft) pend.push('Há um rascunho aguardando a pessoa Liberar na tela do Guard.');
        return text({
          id: purpose.id,
          nome: purpose.name,
          descricao: purpose.description ?? null,
          publicada: published ? readableVersion(published) : null,
          rascunho: draft ? readableVersion(draft) : null,
          pendencias: pend,
          link: client.reviewLink(purpose.id),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_create_purpose',
    {
      description:
        'Cria uma finalidade nova na conta do Guard como RASCUNHO (proposta do agente). Nada vai ao ar: a pessoa revisa e clica em Liberar na tela do Guard. Descreva o uso do dado, o texto que a pessoa vai ler e a base legal. Regras checadas antes de enviar: legítimo interesse não vale com dado sensível (use consentimento) e exige o teste nas 3 fases (lia_interest, lia_necessity, lia_balance) e como se opor (lia_opt_out). Consulte guard_list_purposes antes para não duplicar. Exige guard_login com permissão de edição.',
      inputSchema: z.object({
        title: z.string().min(1).max(100).describe('Nome curto da finalidade. Ex: "Envio de newsletter".'),
        description: z.string().min(1).max(1200).describe('Para que o dado é usado, em linguagem simples.'),
        consent_text: z.string().min(1).max(2400).describe('Texto que a pessoa (titular) lê no ponto de coleta.'),
        legal_basis: z.enum(LEGAL_BASES).describe('Base legal: consent, legitimate_interest, contract ou legal_obligation.'),
        grouping_identifier: z.enum(['email', 'cpf', 'phone', 'none']).optional().describe('Como o titular é identificado.'),
        ...contextFields,
        agente: agenteField,
        resumo: z.string().min(1).max(500).optional().describe('Por que o agente propõe esta finalidade (ex: onde no código o dado é coletado).'),
      }),
      annotations: { title: 'Criar finalidade (rascunho)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const problems = validatePurposeRules({ basis: input.legal_basis, sensitive: input.sensitive, lia: liaFrom(input) });
      if (problems.length) return rulesFailure(problems);
      const { agente, resumo, ...campos } = input;
      try {
        const created = await client.createAssisted({
          ...defined(campos),
          proposta: { agente: agente ?? DEFAULT_AGENTE, resumo: resumo ?? `Proposta criada por ${agente ?? 'um agente de IA'} via MCP.` },
        });
        return text({
          id: created.id,
          nome: created.name,
          rascunho_id: created.draft_version_id,
          status: 'rascunho',
          link: client.reviewLink(created.id),
          aviso: `${LIBERAR} Abra ${client.reviewLink(created.id)} para revisar.`,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_update_purpose',
    {
      description:
        'Edita uma finalidade existente como RASCUNHO. Se ela só tem versão publicada, cria um rascunho a partir dela; a publicada continua no ar até a pessoa Liberar a nova na tela do Guard. Mande só os campos que mudam: o resto (outros contextos, pontos de coleta, teste de legítimo interesse) é preservado. resumo é obrigatório: diga o que mudou e por quê, a pessoa lê isso ao revisar. Contextos: law escolhe qual contexto (br/eu) editar; sem law, edita o primeiro. Se a finalidade já tem um rascunho aberto por uma pessoa (ou por outro agente), o agente não mexe: a pessoa precisa liberar ou descartar antes. Exige guard_login com permissão de edição.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Id da finalidade.'),
        resumo: z.string().min(1).max(500).describe('O que mudou e por quê. Obrigatório.'),
        agente: agenteField,
        title: z.string().min(1).max(100).optional(),
        description: z.string().min(1).max(1200).optional(),
        consent_text: z.string().min(1).max(2400).optional(),
        legal_basis: z.enum(LEGAL_BASES).optional(),
        grouping_identifier: z.enum(['email', 'cpf', 'phone', 'none']).optional(),
        ...contextFields,
      }),
      annotations: { title: 'Editar finalidade (rascunho)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const { id, resumo, agente, ...changes } = input;
      if (Object.values(changes).every((v) => v === undefined)) {
        return { content: [{ type: 'text' as const, text: 'Nada para alterar: mande ao menos um campo além de id e resumo.' }], isError: true as const };
      }
      try {
        const versions = await client.versions(id);
        const draft = versions.find((v) => v.status === 'draft');
        if (draft && !isOwnClientProposal(draft)) return failure(new PurposesError(otherDraftMessage(client.reviewLink(id)), 409));
        const published = versions.find((v) => v.status === 'published');
        const origem = draft ?? published;
        if (!origem) return failure(new PurposesError('Essa finalidade não tem versão publicada nem rascunho para editar.'));

        // Valida antes de duplicar, para não deixar rascunho vazio pendurado.
        const { studio, context } = mergeStudio(origem.config?.purpose_studio, changes);
        if (context) {
          const problems = validatePurposeRules({ basis: context.basis ?? origem.legal_basis, sensitive: context.sensitive, lia: context.lia });
          if (problems.length) return rulesFailure(problems);
        }

        let base: PurposeVersion = origem;
        const duplicada = !draft;
        if (duplicada) {
          const dup = await client.duplicate(origem.id);
          base = { ...origem, ...dup, status: 'draft', config: dup.config ?? origem.config ?? null };
        }
        // config.proposta é do servidor: vai no campo proposta, não dentro do config.
        const { proposta: _descartada, ...config } = base.config ?? {};

        await client.patchVersion(base.id, {
          ...defined({
            consent_text: changes.consent_text,
            legal_basis: changes.legal_basis,
            retention_days: changes.retention_days,
            grouping_identifier: changes.grouping_identifier,
          }),
          config: { ...config, purpose_studio: studio },
          proposta: { agente: agente ?? DEFAULT_AGENTE, resumo },
        });
        return text({
          id,
          rascunho_id: base.id,
          criado_a_partir_da_publicada: duplicada,
          alterado: Object.keys(defined(changes)),
          link: client.reviewLink(id),
          aviso: `${LIBERAR} Abra ${client.reviewLink(id)} para revisar.`,
        });
      } catch (error) {
        if (error instanceof PurposesError && error.code && NOT_OWN.has(error.code)) {
          return failure(new PurposesError(otherDraftMessage(client.reviewLink(id)), error.status, error.code));
        }
        if (error instanceof PurposesError && error.code === 'purpose-version-already-published') {
          return failure(new PurposesError('O rascunho foi liberado pela pessoa enquanto você editava. Chame guard_update_purpose de novo para propor em cima da versão nova.', 409));
        }
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_cancel_purpose_draft',
    {
      description:
        'Desiste da proposta (rascunho) que este agente fez numa finalidade. Se a finalidade nasceu da proposta e nunca foi publicada, ela some. Só vale para a própria proposta (mesmo agente e mesma pessoa logada); rascunho aberto na tela, de outra pessoa ou de outro agente, e versão publicada não são tocados. Exige guard_login com permissão de edição.',
      inputSchema: z.object({ id: z.string().min(1).describe('Id da finalidade cujo rascunho será descartado.') }),
      annotations: { title: 'Cancelar proposta de finalidade', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const versions = await client.versions(id);
        const draft = versions.find((v) => v.status === 'draft');
        if (!draft) return failure(new PurposesError('Essa finalidade não tem rascunho: nada para cancelar.'));
        if (!isOwnClientProposal(draft)) return failure(new PurposesError(notOwnCancelMessage(client.reviewLink(id)), 403));
        const res = await client.deleteVersion(draft.id);
        return text({
          cancelado: true,
          rascunho_id: draft.id,
          finalidade_removida: res.purpose_removida === true,
          mensagem: res.purpose_removida
            ? 'Proposta descartada. A finalidade só existia como proposta e foi removida.'
            : 'Proposta descartada. A versão publicada (se houver) continua como estava.',
        });
      } catch (error) {
        if (error instanceof PurposesError && error.code === 'purpose-version-not-own-proposal') {
          return failure(new PurposesError(notOwnCancelMessage(client.reviewLink(id)), error.status, error.code));
        }
        return failure(error);
      }
    },
  );
}
