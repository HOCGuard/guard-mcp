<p align="center">
  <img src=".github/assets/header.webp" alt="HOC Guard MCP conectado a Claude Code, Cursor, Codex, Windsurf, Antigravity, Lovable e Replit" width="100%">
</p>

<h1 align="center">HOC Guard MCP</h1>

<p align="center">
  <strong>Privacidade e LGPD resolvidas de dentro do seu agente de código.</strong><br>
  Banner de cookies, consentimento e varredura de privacidade, sem sair do editor.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-f26522?style=flat-square" alt="Licença Apache-2.0"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocolo-MCP-1a1a1a?style=flat-square" alt="Model Context Protocol"></a>
  <a href="https://www.npmjs.com/package/@hocguard/mcp"><img src="https://img.shields.io/npm/v/@hocguard/mcp?style=flat-square&color=f26522&label=npm" alt="Versão no npm"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-1a1a1a?style=flat-square" alt="Node 20 ou superior">
  <img src="https://img.shields.io/badge/feito%20para-LGPD-f26522?style=flat-square" alt="Feito para a LGPD">
  <img src="https://img.shields.io/badge/status-preview-lightgrey?style=flat-square" alt="Em preview">
</p>

<p align="center">
  <a href="#instalar">Instalar</a> ·
  <a href="#como-usar">Como usar</a> ·
  <a href="#ferramentas">Ferramentas</a> ·
  <a href="#configuração">Configuração</a> ·
  <a href="#princípios">Princípios</a>
</p>

---

Qualquer pessoa cria um app hoje. Quase ninguém sabe o que a LGPD exige dele, e quando pede à IA,
ela improvisa: banner que não bloqueia nada, rastreador disparando antes do consentimento,
formulário sem base legal.

O **HOC Guard MCP** faz o seu agente acertar isso por padrão. Ele lê o seu projeto, entende o que a
aplicação coleta e entrega o código pronto, sobre o SDK do [HOC Guard](https://guard.hoc.app.br),
para o próprio agente aplicar.

> **"Meu app está pronto para lançar?"** é a pergunta. O Guard responde com código, não com um
> relatório.

## Instalar

> [!NOTE]
> Requer Node 20 ou superior. Nada para instalar antes: o `npx` baixa o pacote na primeira execução.

<details open>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add hoc-guard -- npx -y @hocguard/mcp
```

</details>

<details>
<summary><strong>Codex</strong></summary>

Em `~/.codex/config.toml`:

```toml
[mcp_servers.hoc-guard]
command = "npx"
args = ["-y", "@hocguard/mcp"]
```

</details>

<details>
<summary><strong>Cursor, Windsurf, Antigravity e outros clientes MCP</strong></summary>

No arquivo de configuração de MCP do cliente:

```json
{
  "mcpServers": {
    "hoc-guard": {
      "command": "npx",
      "args": ["-y", "@hocguard/mcp"]
    }
  }
}
```

</details>

## Como usar

O caminho mais curto é o roteiro pronto. No Claude Code:

```text
/mcp__hoc-guard__guard-secure-ship
```

Em qualquer cliente MCP ele aparece como o prompt **guard-secure-ship**. O agente diagnostica o
projeto, mostra o plano, pede confirmação, aplica, gera a política em rascunho e verifica de novo.

Ou peça em linguagem natural, dentro do projeto:

```text
Deixe este site pronto para a LGPD.
```

O que acontece por baixo:

1. **Lê o projeto na sua máquina** e detecta rastreadores (Google Analytics, GTM, Meta Pixel,
   TikTok, LinkedIn, Hotjar, Clarity, RD Station, Hotmart, Amplitude, Mixpanel, Segment e outros),
   formulários com dado pessoal e serviços que levam dado para fora do Brasil.
2. **Gera a integração do banner** para carregar antes de qualquer tag e bloqueia cada rastreador
   até o consentimento, na finalidade certa. Só com cookies essenciais, gera um aviso informativo.
3. **Adiciona consentimento aos formulários** e escreve a política de privacidade em rascunho a
   partir do que o app realmente faz.

Depois de publicar, confira o site no ar:

```text
Verifique se o banner do meu site realmente bloqueia os rastreadores.
```

> [!NOTE]
> A análise do projeto é estática: não vê tags injetadas em runtime (GTM, CMS). Por isso o
> diagnóstico nunca diz "conforme"; a confirmação vem da varredura do site publicado.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `guard_login` | Começa o login sem colar token, no estilo `npm login`/`gh auth login`: devolve na hora um link e um código curto pra você autorizar no navegador. Rode uma vez por máquina |
| `guard_login_check` | Conclui o login: depois de autorizar no navegador, confirma e salva a credencial (responde "Conectado"). Se ainda não autorizou, avisa pra tentar de novo |
| `guard_logout` | Encerra o login local (apaga a credencial em `~/.hocguard`) |
| `guard_generate_cookie_banner` | Lê o projeto Next localmente, detecta os rastreadores e devolve a conformidade de cookies: banner de consentimento (se há analytics/marketing) ou aviso informativo (se só há cookies essenciais) |
| `guard_add_consent_point` | Acha formulários que coletam dado pessoal sem consentimento e devolve o ponto de coleta (checkbox com base legal e link de política) |
| `guard_check_compliance` | Diagnóstico local: tracker sem consentimento, formulário sem consentimento, transferência internacional e falta de link de política, com nota 0-100 e relatório em Markdown |
| `guard_make_compliant` | Um comando: roda o diagnóstico e devolve banner, pontos de consentimento, política e um checklist com a nota antes e depois |
| `guard_generate_policy` | Rascunho de política de privacidade que descreve os rastreadores, campos e terceiros que o app realmente usa |
| `guard_explain` | Explica um achado em português: o que é, por que importa, o que a LGPD diz e como corrigir |
| `guard_create_banner` | Cria o banner do site sem precisar de conta e devolve o `banner_id`. O comprovante de posse fica só na sua máquina |
| `guard_scan_site` | Inicia a varredura de um site publicado. Faça `guard_login` antes: a varredura usa o seu login pra provar a posse do domínio (precisa estar entre os domínios verificados da sua conta). Abre um navegador de verdade, aceita e rejeita o banner e observa o que dispara em cada caso |
| `guard_get_scan_status` | Diz se a varredura terminou. Leva cerca de dois minutos |
| `guard_get_scan_results` | Devolve os achados do mais grave para o menos grave, com a nota geral |
| `guard_list_purposes` | Lista as finalidades da sua conta, com filtro por status (publicada, rascunho, proposta de agente) e base legal |
| `guard_get_purpose` | Mostra uma finalidade legível: versão publicada, rascunho e pendências (retenção vazia, legítimo interesse sem teste) |
| `guard_create_purpose` | Cria uma finalidade nova como rascunho, para a pessoa revisar e liberar |
| `guard_update_purpose` | Edita uma finalidade como rascunho (cria o rascunho a partir da publicada se preciso), com resumo do que mudou |
| `guard_cancel_purpose_draft` | Desiste de uma proposta feita pelo agente |

A varredura é demorada, então o ciclo tem três passos em vez de uma chamada que expira. O resultado
traz só o que precisa de atenção; passe `include_passed` para ver também o que está correto.

## Finalidades

Com login (`guard_login`), o agente consulta e propõe as finalidades de tratamento de dados da sua
conta no Guard: para que cada dado pessoal é usado, o texto que o titular lê, a base legal, a
retenção e o teste de legítimo interesse.

**Tudo o que o agente cria ou edita é rascunho.** Nada muda para os titulares até uma pessoa abrir o
link devolvido (`/privacidade/finalidades/<id>`), revisar e clicar em **Liberar**. O fluxo é:

1. o agente lê o que já existe (`guard_list_purposes`, `guard_get_purpose`);
2. propõe uma finalidade nova ou um ajuste (`guard_create_purpose`, `guard_update_purpose`), com um
   resumo do que mudou e por quê;
3. a pessoa libera, edita ou descarta na tela do Guard.

| O agente pode | O agente não pode |
|---|---|
| Consultar finalidades e versões | Publicar (liberar) uma finalidade: o Guard recusa |
| Criar finalidade nova como rascunho | Alterar a versão publicada: a edição sempre vira rascunho |
| Editar o rascunho, preservando o que não mandou | Usar legítimo interesse com dado sensível |
| Editar e cancelar a própria proposta (mesmo agente e mesma pessoa) | Mexer em rascunho aberto na tela, por outra pessoa ou por outro agente |
| Propor em cima da versão liberada (vira um rascunho novo) | Abrir outro rascunho quando já há um rascunho de outra pessoa: ela libera ou descarta antes |
| Consultar e propor finalidades | Chegar a qualquer outra rota do Guard: o token do agente só alcança finalidades |

Regras checadas antes de enviar: legítimo interesse não vale para dado sensível (use consentimento)
e sempre exige o teste nas três fases (interesse, necessidade, balanceamento) e como a pessoa se opõe.
O login pede `gcc:purposes:read gcc:purposes:write` por padrão, mas o token só recebe o que o papel
da pessoa na conta permite; sem permissão de edição, as ferramentas de escrita dizem isso.

O roteiro pronto é o prompt **guard-map-purposes** (e a skill `skills/guard-map-purposes`): acha no
código onde o app coleta dado pessoal (`guard_add_consent_point`), compara com o que já existe e
propõe as finalidades com confirmação.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `GUARD_SDK_URL` | `https://guard.hoc.app.br/sdk/banner.js` | De onde o site carrega o banner |
| `GUARD_API_URL` | `http://localhost:3085` | Onde está o serviço de varredura |
| `GUARD_AUTH_URL` | `https://guard.hoc.app.br` | Issuer do login (`guard_login`, Device Flow) e origem da API de finalidades |
| `GUARD_SERVICE_TOKEN` | (nenhum) | Token de serviço pra uso interno. No dia a dia, prefira `guard_login` |
| `GUARD_CREDENTIALS_PATH` | `<GUARD_HOME>/.hocguard/credentials.json` | Onde a credencial do login é guardada (útil em testes) |
| `GUARD_TENANT` | `public` | Identificação da conta, quando houver |
| `GUARD_REQUEST_TIMEOUT_MS` | `15000` | Tempo limite de cada chamada, não da varredura |
| `GUARD_TELEMETRY` | desligada | `1` liga a telemetria de uso anônima (ver abaixo) |
| `GUARD_TELEMETRY_URL` | origem do SDK + `/api/v1/public/mcp/telemetry` | Para onde vão os eventos |
| `GUARD_HOME` | sua pasta pessoal | Onde fica `.hocguard/` (id de instalação e banners criados) |

### Telemetria

Desligada por padrão. Com `GUARD_TELEMETRY=1`, cada chamada de ferramenta envia um evento com
**apenas**: nome da ferramenta, versão, sucesso ou erro, duração, o modo gerado, o framework, a
contagem de achados, a nota e o nome do agente, mais um id de instalação aleatório. **Nunca** código,
caminho de arquivo, URL varrida, nome de projeto ou dado pessoal. Falha no envio nunca afeta a
ferramenta. O contrato está em `src/telemetry.ts` e é recusado no servidor se vier com campo a mais.

## Princípios

| | |
|---|---|
| 🔒 **Seu código não sai da sua máquina** | A análise de código roda local. Varredura de site é remota, porque site é público por definição |
| 🆓 **Sem conta para o básico** | As ferramentas desta camada não guardam dados do cliente |
| ⚖️ **Conformidade nunca é limitada** | O que é grátis é conforme. O pago é conveniência e escala |
| 🪪 **Varredura profunda só com prova de propriedade** | Banco de dados e repositório privado exigem comprovação de que o alvo é seu |
| 🧱 **Saída é dado, não instrução** | O que voltar de um site varrido nunca é tratado como comando pelo agente |

## Skill

`skills/guard-secure-ship/SKILL.md` e `skills/guard-map-purposes/SKILL.md` trazem os mesmos roteiros
dos prompts para agentes que usam skills. São geradas de `src/workflow.ts` com `npm run gen:skill`;
um teste falha se divergirem.

## Desenvolvimento

```bash
npm install
npm run build
npm test
```

## Licença

[Apache-2.0](./LICENSE). O servidor é aberto para você auditar o que instalou; os motores do HOC
Guard rodam no nosso serviço.

<p align="center">
  <sub>Feito pelo <a href="https://guard.hoc.app.br">HOC Guard</a>.</sub>
</p>
