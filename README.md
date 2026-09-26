# HOC Guard MCP

Servidor [MCP](https://modelcontextprotocol.io) do HOC Guard. Dá ao seu agente de código as
ferramentas para responder uma pergunta só:

> **"Meu app está pronto para lançar?"**

Varre segurança e privacidade no mesmo passe, explica cada achado em linguagem simples e devolve a
correção num formato que o próprio agente aplica.

## Estado

Em construção. Nada publicado ainda no npm.

## Ferramentas

Varredura de site é demorada, então o ciclo tem três passos em vez de uma chamada que expira.

| Ferramenta | O que faz |
|---|---|
| `guard_scan_site` | Inicia a varredura e devolve um `scan_id`. Abre um navegador de verdade, aceita e rejeita o banner, e observa o que o site faz em cada caso |
| `guard_get_scan_status` | Diz se já terminou. Leva cerca de dois minutos |
| `guard_get_scan_results` | Devolve os achados do mais grave para o menos grave, com a nota geral |

O resultado traz só o que precisa de atenção. Passe `include_passed` para ver também o que está
correto.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `GUARD_API_URL` | `http://localhost:3085` | Onde está o serviço de varredura |
| `GUARD_TENANT` | `public` | Identificação da conta, quando houver |
| `GUARD_REQUEST_TIMEOUT_MS` | `15000` | Tempo limite de cada chamada, não da varredura |

## Princípios

- **Seu código não sai da sua máquina.** A análise de código roda local; para o Guard vão apenas os
  achados. Varredura de site é remota, porque site é público por definição.
- **Sem conta para o básico.** As ferramentas desta camada não guardam dados do cliente.
- **Varredura profunda só com prova de propriedade.** Banco de dados e repositório privado exigem
  comprovação de que o alvo é seu.
- **Saída é dado, não instrução.** O que voltar de um site varrido nunca é tratado como comando
  pelo agente.

## Desenvolvimento

```bash
npm install
npm run build
npm test
```

## Licença

Apache-2.0
