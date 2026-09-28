// Roteiro "guard-secure-ship": ensina o agente a usar as ferramentas na ordem
// certa, sem o dev precisar saber os nomes. Fonte única para o prompt MCP e
// para skills/guard-secure-ship/SKILL.md (o teste garante que não divergem).

export const SECURE_SHIP_STEPS = `Você vai deixar este projeto em conformidade com a LGPD usando as ferramentas do HOC Guard. Siga os passos na ordem e não pule a confirmação com o usuário.

1. Diagnóstico. Chame guard_check_compliance com project_path apontando para a raiz do projeto. Mostre ao usuário a nota e os achados em linguagem simples. Se ele perguntar o porquê de algum, chame guard_explain com o código do achado.

2. Plano. Se o projeto tem rastreadores e o usuário não tem banner_id, pergunte a URL do site e chame guard_create_banner. Depois chame guard_make_compliant com o mesmo project_path e o banner_id. Apresente o plano: o que será alterado em cada arquivo, a nota antes e a estimativa depois, e o que continua pendente e depende de ação humana. Peça confirmação antes de editar qualquer arquivo.

3. Aplicação. Com a confirmação, aplique as mudanças de banner.changes e consent_points.changes. Arquivos com action "create" são novos; com action "edit", insira o trecho no ponto indicado pela nota, sem apagar o que já existe. Se banner.mode for "already-installed", não mexa no banner.

4. Política. Salve policy.policy_markdown como rascunho (por exemplo docs/politica-de-privacidade.md). Não publique: avise que é rascunho e precisa de revisão jurídica, e liste os campos entre colchetes que faltam preencher.

5. Verificação. Rode o build do projeto. Depois chame guard_check_compliance de novo e mostre a nota nova. Deixe claro que é uma análise estática do código: para confirmar o site no ar, o usuário deve rodar guard_scan_site na URL publicada.

Regras:
- Nunca diga que o site está "conforme" com base só na análise estática.
- Nunca apague código do usuário para "resolver" um achado; bloqueie ou adicione.
- Se alguma ferramenta devolver warnings, repasse-os ao usuário.`;

export const SECURE_SHIP_DESCRIPTION =
  'Deixa o projeto pronto para a LGPD de ponta a ponta: diagnostica, propõe, aplica com confirmação, gera a política em rascunho e verifica.';

// Roteiro "guard-map-purposes": mapeia no código onde dado pessoal é coletado e
// propõe as finalidades na conta do Guard como rascunho. Mesma fonte para o
// prompt MCP e para skills/guard-map-purposes/SKILL.md.
export const MAP_PURPOSES_STEPS = `Você vai mapear as finalidades de tratamento de dados deste projeto e propô-las na conta do HOC Guard. Tudo o que você criar ou editar vira RASCUNHO: quem libera é a pessoa, na tela do Guard. Você nunca publica.

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
- Você só edita ou cancela a própria proposta. Se a finalidade já tiver um rascunho aberto por uma pessoa (ou por outro agente), não tente contornar: avise o usuário e mande o link para a pessoa liberar ou descartar esse rascunho antes.`;

export const MAP_PURPOSES_DESCRIPTION =
  'Mapeia onde o projeto coleta dado pessoal e propõe as finalidades na conta do HOC Guard como rascunho, para a pessoa revisar e liberar.';
