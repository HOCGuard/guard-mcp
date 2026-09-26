# HOC Guard MCP

Servidor [MCP](https://modelcontextprotocol.io) do HOC Guard. Dá ao seu agente de código as
ferramentas para responder uma pergunta só:

> **"Meu app está pronto para lançar?"**

Varre segurança e privacidade no mesmo passe, explica cada achado em linguagem simples e devolve a
correção num formato que o próprio agente aplica.

## Estado

Em construção. Nada publicado ainda no npm.

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
