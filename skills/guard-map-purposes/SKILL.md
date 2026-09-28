---
name: guard-map-purposes
description: "Mapeia onde o projeto coleta dado pessoal e propõe as finalidades na conta do HOC Guard como rascunho, para a pessoa revisar e liberar. Use quando o usuário pedir para mapear finalidades, bases legais, o que o app faz com dado pessoal, ou cadastrar finalidades no HOC Guard. Requer o servidor MCP @hocguard/mcp instalado e login (guard_login)."
---

# guard-map-purposes

<!-- Gerado de src/workflow.ts por `npm run gen:skill`. Não edite à mão. -->

Você vai mapear as finalidades de tratamento de dados deste projeto e propô-las na conta do HOC Guard. Tudo o que você criar ou editar vira RASCUNHO: quem libera é a pessoa, na tela do Guard. Você nunca publica.

1. Login. Se alguma ferramenta de finalidades responder que falta login ou permissão, chame guard_login (o scope padrão já inclui gcc:purposes:read e gcc:purposes:write), mostre o link ao usuário e conclua com guard_login_check.

2. O que já existe. Chame guard_list_purposes para ver as finalidades da conta. Para as que parecerem relacionadas ao projeto, chame guard_get_purpose e anote as pendências.

3. Onde o projeto coleta dado pessoal. Chame guard_add_consent_point com project_path apontando para a raiz do projeto. Cada formulário devolvido (e cada rastreador, se houver) indica um uso de dado: cadastro, newsletter, contato, checkout, analytics. Agrupe por uso, não por arquivo.

4. Plano. Para cada uso, diga se já existe finalidade equivalente (então proponha ajuste com guard_update_purpose) ou se precisa de uma nova (guard_create_purpose). Para cada uma, proponha: título, para que o dado é usado, o texto que a pessoa vai ler, a base legal com justificativa e a retenção. Mostre o plano e peça confirmação antes de enviar qualquer coisa.

5. Envio. Com a confirmação, chame guard_create_purpose ou guard_update_purpose. Em resumo, diga onde no código o dado é coletado e por quê. Se a ferramenta recusar por regra (por exemplo, legítimo interesse com dado sensível), explique ao usuário e ajuste; não tente contornar.

6. Entrega. Liste os links devolvidos e diga claramente: cada finalidade é um rascunho e a pessoa precisa clicar em Liberar na tela do Guard para valer. Se o usuário desistir de uma proposta sua, use guard_cancel_purpose_draft.

Regras:
- Nunca diga que uma finalidade está publicada ou em vigor: você só cria rascunhos.
- Legítimo interesse não vale para dado sensível (saúde, biometria, religião, origem racial etc); nesses casos use consentimento. Com legítimo interesse, preencha sempre as 3 fases do teste e como a pessoa se opõe.
- Prefira ajustar uma finalidade existente a criar uma duplicada.
- Você só edita ou cancela a própria proposta. Se a finalidade já tiver um rascunho aberto por uma pessoa (ou por outro agente), não tente contornar: avise o usuário e mande o link para a pessoa liberar ou descartar esse rascunho antes.
