// Markdown do agente → documento do editor do Guard (blocos ProseMirror, o mesmo
// JSON que a tela grava). Só o que um documento jurídico usa: títulos,
// parágrafos, listas, negrito, itálico, link e dado da empresa ({{chave}}, que
// vira a variável do documento e mostra o valor de hoje).
//
// Lacuna entre colchetes ("[CNPJ da empresa]") não vira texto: volta como aviso,
// porque o Guard trava a publicação com ela.

export interface NoTexto {
  type: 'text';
  text: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
export interface NoVariavel {
  type: 'variable';
  attrs: { key: string };
}
type Inline = NoTexto | NoVariavel;
export interface Bloco {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<Bloco | Inline>;
}

export interface DocumentoDoEditor {
  schemaVersion: 1;
  doc: { type: 'doc'; content: Bloco[] };
}

export interface Conversao {
  documento: DocumentoDoEditor;
  /** Lacunas entre colchetes encontradas no texto (o Guard não publica com elas). */
  lacunas: string[];
  /** {{chave}} que não é variável do documento: ficou como texto. */
  variaveisDesconhecidas: string[];
  /** Títulos das seções, na ordem. */
  secoes: string[];
}

const LACUNA = /\[(?!\s*\d+\s*\])([^\]\n]{2,80})\](?!\()/g;
const VARIAVEL = /\{\{\s*([a-z0-9_.-]{1,60})\s*\}\}/gi;
// Negrito, itálico e link, nessa ordem de prioridade.
const MARCA = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\))/;

function marcado(texto: string, marks: NoTexto['marks'], chaves: ReadonlySet<string> | null, desconhecidas: Set<string>): Inline[] {
  const saida: Inline[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(VARIAVEL)) {
    const chave = (m[1] ?? '').toLowerCase();
    if (chaves && !chaves.has(chave)) {
      desconhecidas.add(chave);
      continue;
    }
    if (m.index! > ultimo) saida.push({ type: 'text', text: texto.slice(ultimo, m.index), ...(marks?.length ? { marks } : {}) });
    saida.push({ type: 'variable', attrs: { key: chave } });
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < texto.length) saida.push({ type: 'text', text: texto.slice(ultimo), ...(marks?.length ? { marks } : {}) });
  return saida;
}

function inline(texto: string, chaves: ReadonlySet<string> | null, desconhecidas: Set<string>, marks: NoTexto['marks'] = []): Inline[] {
  const saida: Inline[] = [];
  let resto = texto;
  while (resto) {
    const m = MARCA.exec(resto);
    if (!m) {
      saida.push(...marcado(resto, marks, chaves, desconhecidas));
      break;
    }
    if (m.index > 0) saida.push(...marcado(resto.slice(0, m.index), marks, chaves, desconhecidas));
    if (m[2] ?? m[3]) saida.push(...inline(m[2] ?? m[3]!, chaves, desconhecidas, [...(marks ?? []), { type: 'bold' }]));
    else if (m[4] ?? m[5]) saida.push(...inline(m[4] ?? m[5]!, chaves, desconhecidas, [...(marks ?? []), { type: 'italic' }]));
    else saida.push(...inline(m[6]!, chaves, desconhecidas, [...(marks ?? []), { type: 'link', attrs: { href: m[7] } }]));
    resto = resto.slice(m.index + m[0].length);
  }
  return saida.filter((n) => n.type !== 'text' || n.text.length > 0);
}

const paragrafo = (texto: string, chaves: ReadonlySet<string> | null, d: Set<string>): Bloco => ({ type: 'paragraph', content: inline(texto, chaves, d) });

/**
 * Converte o Markdown. `chaves` = variáveis do documento (editor-context); sem
 * elas, todo {{chave}} vira variável e o Guard mostra as que não existem como
 * pendência.
 */
export function markdownParaDocumento(markdown: string, chaves: ReadonlySet<string> | null = null): Conversao {
  const desconhecidas = new Set<string>();
  const lacunas = [...new Set([...markdown.matchAll(LACUNA)].map((m) => m[0]))];
  const secoes: string[] = [];
  const blocos: Bloco[] = [];
  const linhas = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragrafoAberto: string[] = [];
  let lista: { tipo: 'bulletList' | 'orderedList'; itens: string[] } | null = null;

  const fecharParagrafo = () => {
    const t = paragrafoAberto.join(' ').replace(/\s+/g, ' ').trim();
    if (t) blocos.push(paragrafo(t, chaves, desconhecidas));
    paragrafoAberto = [];
  };
  const fecharLista = () => {
    if (lista) blocos.push({ type: lista.tipo, content: lista.itens.map((i) => ({ type: 'listItem', content: [paragrafo(i, chaves, desconhecidas)] })) });
    lista = null;
  };

  for (const bruta of linhas) {
    const linha = bruta.trim();
    const titulo = /^(#{1,4})\s+(.+)$/.exec(linha) as [string, string, string] | null;
    const item = /^[-*+]\s+(.+)$/.exec(linha) as [string, string] | null;
    const numerado = /^\d+[.)]\s+(.+)$/.exec(linha) as [string, string] | null;
    if (!linha) {
      fecharParagrafo();
      fecharLista();
    } else if (titulo) {
      fecharParagrafo();
      fecharLista();
      const texto = titulo[2].replace(/\s+#+$/, '').trim();
      // O título do documento é o do cadastro: "#" vira seção, como "##".
      const nivel = Math.min(Math.max(titulo[1].length, 2), 3);
      if (nivel === 2) secoes.push(texto);
      blocos.push({ type: 'heading', attrs: { level: nivel }, content: inline(texto, chaves, desconhecidas) });
    } else if (item || numerado) {
      fecharParagrafo();
      const tipo = item ? 'bulletList' : 'orderedList';
      if (lista && lista.tipo !== tipo) fecharLista();
      lista ??= { tipo, itens: [] };
      lista.itens.push((item ?? numerado)![1]);
    } else if (lista && /^\s{2,}/.test(bruta)) {
      // Continuação do item anterior.
      lista.itens[lista.itens.length - 1] = `${lista.itens[lista.itens.length - 1] ?? ''} ${linha}`;
    } else {
      fecharLista();
      paragrafoAberto.push(linha);
    }
  }
  fecharParagrafo();
  fecharLista();

  return {
    documento: { schemaVersion: 1, doc: { type: 'doc', content: blocos } },
    lacunas,
    variaveisDesconhecidas: [...desconhecidas],
    secoes,
  };
}
