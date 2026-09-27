// Gera skills/guard-secure-ship/SKILL.md a partir de src/workflow.ts.
import { writeFile } from 'node:fs/promises';
import { SECURE_SHIP_DESCRIPTION, SECURE_SHIP_STEPS } from '../src/workflow.ts';

const description = `${SECURE_SHIP_DESCRIPTION} Use quando o usuário pedir para adequar o app à LGPD, colocar banner de cookies, consentimento em formulário, política de privacidade, ou perguntar se o site está pronto para lançar do ponto de vista de privacidade. Requer o servidor MCP @hocguard/mcp instalado.`;

const skill = `---
name: guard-secure-ship
description: ${JSON.stringify(description)}
---

# guard-secure-ship

<!-- Gerado de src/workflow.ts por \`npm run gen:skill\`. Não edite à mão. -->

${SECURE_SHIP_STEPS}
`;

await writeFile(new URL('../skills/guard-secure-ship/SKILL.md', import.meta.url), skill);
console.log('skills/guard-secure-ship/SKILL.md atualizado');
