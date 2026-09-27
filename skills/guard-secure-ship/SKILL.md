---
name: guard-secure-ship
description: "Deixa o projeto pronto para a LGPD de ponta a ponta: diagnostica, propõe, aplica com confirmação, gera a política em rascunho e verifica. Use quando o usuário pedir para adequar o app à LGPD, colocar banner de cookies, consentimento em formulário, política de privacidade, ou perguntar se o site está pronto para lançar do ponto de vista de privacidade. Requer o servidor MCP @hocguard/mcp instalado."
---

# guard-secure-ship

<!-- Gerado de src/workflow.ts por `npm run gen:skill`. Não edite à mão. -->

Você vai deixar este projeto em conformidade com a LGPD usando as ferramentas do HOC Guard. Siga os passos na ordem e não pule a confirmação com o usuário.

1. Diagnóstico. Chame guard_check_compliance com project_path apontando para a raiz do projeto. Mostre ao usuário a nota e os achados em linguagem simples. Se ele perguntar o porquê de algum, chame guard_explain com o código do achado.

2. Plano. Se o projeto tem rastreadores e o usuário não tem banner_id, pergunte a URL do site e chame guard_create_banner. Depois chame guard_make_compliant com o mesmo project_path e o banner_id. Apresente o plano: o que será alterado em cada arquivo, a nota antes e a estimativa depois, e o que continua pendente e depende de ação humana. Peça confirmação antes de editar qualquer arquivo.

3. Aplicação. Com a confirmação, aplique as mudanças de banner.changes e consent_points.changes. Arquivos com action "create" são novos; com action "edit", insira o trecho no ponto indicado pela nota, sem apagar o que já existe. Se banner.mode for "already-installed", não mexa no banner.

4. Política. Salve policy.policy_markdown como rascunho (por exemplo docs/politica-de-privacidade.md). Não publique: avise que é rascunho e precisa de revisão jurídica, e liste os campos entre colchetes que faltam preencher.

5. Verificação. Rode o build do projeto. Depois chame guard_check_compliance de novo e mostre a nota nova. Deixe claro que é uma análise estática do código: para confirmar o site no ar, o usuário deve rodar guard_scan_site na URL publicada.

Regras:
- Nunca diga que o site está "conforme" com base só na análise estática.
- Nunca apague código do usuário para "resolver" um achado; bloqueie ou adicione.
- Se alguma ferramenta devolver warnings, repasse-os ao usuário.
