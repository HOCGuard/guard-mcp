import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.ts';
import type { TokenProvider } from '../auth/session.ts';
import { DOCUMENT_TYPES, DocumentsClient, DocumentsError, idDe, type LegalDocument } from '../documents-client.ts';
import { markdownParaDocumento } from '../generate/documento.ts';

// Documentos jurídicos na conta do Guard (Hguard-2015). O agente lê e escreve o
// RASCUNHO no editor do Guard; quem revisa e publica é a pessoa, na tela.
// Nenhuma ferramenta daqui publica.

const PUBLICAR =
  'Isto é um rascunho: a versão no ar não muda até uma pessoa revisar e clicar em Publicar na tela do Guard. Mostre o link ao usuário. O agente não publica.';

const TIPO_LABEL: Record<string, string> = {
  privacy: 'Política de Privacidade',
  terms: 'Termos de Uso',
  cookies: 'Política de Cookies',
  subprocessadores: 'Suboperadores',
  terceiros: 'Terceiros',
  custom: 'Documento livre',
  direitos: 'Canal de direitos',
};

// O que um bom rascunho precisa: vai na descrição para o agente escrever certo
// de primeira (é o mesmo critério que o HOC AI do editor segue).
const COMO_ESCREVER = [
  'Escreva em Markdown: "## Título" para cada seção, parágrafos, listas com "-", **negrito** e [link](https://...).',
  'Dados da empresa (nome, endereço, encarregado, e-mail, telefone, site) entram como {{chave}}, com a chave que guard_get_document lista em variaveis; nunca escreva o valor nem invente um dado.',
  'NUNCA deixe lacuna entre colchetes como [CNPJ]: o Guard não publica com ela. Se falta um dado, pergunte ao usuário ou deixe a frase de fora.',
  'Escreva só o que o produto faz de verdade (o usuário diz, ou está no código que você leu): sem recurso, integração, fornecedor, país ou prazo inventado.',
  'Se o produto usa APIs do Google (login, Gmail, Planilhas, Drive...), a política precisa citar cada permissão e para que serve, dizer que os dados não são vendidos nem usados para publicidade ou para treinar IA, como revogar, e trazer: "O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google seguem a Política de Dados do Usuário dos Serviços de API do Google (https://developers.google.com/terms/api-services-user-data-policy), incluindo os requisitos de Uso Limitado."',
].join(' ');

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function failure(error: unknown) {
  const message = error instanceof DocumentsError ? error.message : `Falha inesperada: ${String(error)}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function resumo(client: DocumentsClient, d: LegalDocument) {
  return {
    id: idDe(d),
    tipo: d.tipo,
    tipo_nome: TIPO_LABEL[d.tipo] ?? d.tipo,
    titulo: d.des_titulo ?? d.des_nome ?? null,
    nome: d.des_nome ?? null,
    situacao: d.des_status === 'published' ? 'publicado' : d.des_status === 'archived' ? 'arquivado' : 'rascunho',
    versao_no_ar: d.nr_version ?? 0,
    link: client.link(idDe(d)),
  };
}

/** Títulos de seção do documento (nível 2), para o agente saber o que já existe. */
function secoesDe(d: LegalDocument): string[] {
  const titulo = (n: { content?: Array<{ text?: string }> }) => (n.content ?? []).map((c) => c.text ?? '').join('').trim();
  return (d.json_input?.doc.content ?? []).filter((n) => n.type === 'heading' && n.attrs?.level === 2).map((n) => titulo(n as never)).filter(Boolean);
}

/** O que ainda impede publicar, em frases para o usuário. */
async function pendencias(client: DocumentsClient, id: string): Promise<{ pronto: boolean; falta: string[] }> {
  const c = await client.checklist(id);
  const falta = c.issues.map((i) => (i.items?.length ? `${i.message} (${i.items.slice(0, 8).join(', ')})` : i.message));
  return { pronto: c.ready, falta };
}

export function registerDocumentTools(server: McpServer, config: Config, tokens?: TokenProvider): void {
  const client = new DocumentsClient(config, tokens);

  server.registerTool(
    'guard_list_documents',
    {
      description:
        'Lista os documentos jurídicos da conta do HOC Guard (política de privacidade, termos de uso, política de cookies, documentos livres), com a situação de cada um (rascunho, publicado) e o link da tela. Use antes de escrever, para atualizar o documento certo em vez de criar outro. Exige guard_login.',
      inputSchema: z.object({
        tipo: z.enum([...DOCUMENT_TYPES, 'direitos']).optional().describe('privacy, terms, cookies, subprocessadores, terceiros, custom ou direitos.'),
      }),
      annotations: { title: 'Listar documentos', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ tipo }) => {
      try {
        const docs = (await client.list(tipo)).filter((d) => d.des_status !== 'archived');
        return text({ total: docs.length, documentos: docs.map((d) => resumo(client, d)) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_get_document',
    {
      description:
        'Lê um documento jurídico da conta: título, situação, as seções que já tem, a revisão atual (passe-a em guard_write_document_draft) e as variáveis do documento (dados da empresa que entram no texto como {{chave}}; as vazias a pessoa preenche na tela). Exige guard_login.',
      inputSchema: z.object({ document_id: z.string().min(1).max(64) }),
      annotations: { title: 'Ler documento', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document_id }) => {
      try {
        const [doc, variaveis] = await Promise.all([client.get(document_id), client.variables(document_id).catch(() => [])]);
        return text({
          ...resumo(client, doc),
          revisao: doc.nr_revision ?? 0,
          secoes: secoesDe(doc),
          variaveis: variaveis.map((v) => ({ chave: v.key, nome: v.label, preenchida: v.value.trim() !== '', obrigatoria: v.required })),
          como_citar: 'Escreva {{chave}} no texto; o Guard mostra o valor de hoje.',
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_write_document_draft',
    {
      description:
        `Escreve o RASCUNHO de um documento jurídico no editor do HOC Guard a partir de Markdown: cria um documento novo (tipo + título) ou substitui o texto do rascunho de um existente (document_id + revision lida em guard_get_document). Nunca publica: a pessoa revisa e publica na tela, e a versão no ar não muda até lá. Devolve o link e o que ainda falta para publicar. ${COMO_ESCREVER} Exige guard_login.`,
      inputSchema: z
        .object({
          document_id: z.string().min(1).max(64).optional().describe('Documento existente. Sem ele, cria um novo do tipo informado.'),
          revision: z.number().int().nonnegative().optional().describe('Revisão lida em guard_get_document. Obrigatória com document_id: o agente nunca grava por cima de uma edição que não viu.'),
          tipo: z.enum(DOCUMENT_TYPES).optional().describe('Para criar: privacy, terms, cookies, subprocessadores, terceiros ou custom.'),
          titulo: z.string().min(1).max(200).describe('Título que o leitor vê. Ex.: "Política de Privacidade do HOC Guard".'),
          nome: z.string().max(200).optional().describe('Nome na lista do Guard, se diferente do título.'),
          markdown: z.string().min(20).max(60_000).describe('O texto inteiro do documento, em Markdown.'),
        })
        .refine((v) => (v.document_id ? v.revision !== undefined : !!v.tipo), {
          message: 'Para atualizar, passe document_id e revision (de guard_get_document). Para criar, passe tipo.',
        }),
      // Substitui o texto do rascunho (a versão no ar fica): o cliente do agente pede aprovação.
      annotations: { title: 'Escrever rascunho de documento', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document_id, revision, tipo, titulo, nome, markdown }) => {
      try {
        // Variáveis do documento: só as conhecidas viram dado da empresa.
        const chavesDe = async (id: string) => new Set((await client.variables(id).catch(() => [])).map((v) => v.key));
        if (document_id) {
          const conversao = markdownParaDocumento(markdown, await chavesDe(document_id));
          if (conversao.lacunas.length) return lacunas(conversao.lacunas);
          const doc = await client.saveDraft(document_id, { json_input: conversao.documento, des_titulo: titulo, ...(nome ? { des_nome: nome } : {}), expected_revision: revision! });
          return text({ ...resumo(client, doc), criado: false, secoes: conversao.secoes, variaveis_desconhecidas: conversao.variaveisDesconhecidas, ...(await pendencias(client, document_id)), aviso: PUBLICAR });
        }
        // Lacuna barra antes de criar: não sobra documento vazio na conta.
        if (markdownParaDocumento(markdown).lacunas.length) return lacunas(markdownParaDocumento(markdown).lacunas);
        const criado = await client.create(tipo!, titulo, nome);
        const id = idDe(criado);
        const conversao = markdownParaDocumento(markdown, await chavesDe(id));
        const doc = await client.saveDraft(id, { json_input: conversao.documento, des_titulo: titulo, ...(nome ? { des_nome: nome } : {}), expected_revision: criado.nr_revision ?? 0 });
        return text({ ...resumo(client, doc), criado: true, secoes: conversao.secoes, variaveis_desconhecidas: conversao.variaveisDesconhecidas, ...(await pendencias(client, id)), aviso: PUBLICAR });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guard_check_document',
    {
      description:
        'Confere o que ainda falta para publicar um documento (o mesmo checklist da tela do Guard): seções em aberto, lacunas, dados da empresa vazios, sugestões pendentes, aprovação. Exige guard_login.',
      inputSchema: z.object({ document_id: z.string().min(1).max(64) }),
      annotations: { title: 'Conferir documento', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document_id }) => {
      try {
        return text({ id: document_id, link: client.link(document_id), ...(await pendencias(client, document_id)), aviso: PUBLICAR });
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function lacunas(lista: string[]) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `O texto tem lacuna entre colchetes (${lista.slice(0, 10).join(', ')}). O Guard não publica com ela: pergunte o dado ao usuário, use a variável do documento ({{chave}}) ou tire a frase, e mande de novo. Nada foi gravado.`,
      },
    ],
    isError: true as const,
  };
}
