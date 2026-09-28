// Gera as skills em skills/ a partir de src/workflow.ts.
import { mkdir, writeFile } from 'node:fs/promises';
import { MAP_PURPOSES_DESCRIPTION, MAP_PURPOSES_STEPS, SECURE_SHIP_DESCRIPTION, SECURE_SHIP_STEPS } from '../src/workflow.ts';

const skills = [
  {
    name: 'guard-secure-ship',
    description: `${SECURE_SHIP_DESCRIPTION} Use quando o usuário pedir para adequar o app à LGPD, colocar banner de cookies, consentimento em formulário, política de privacidade, ou perguntar se o site está pronto para lançar do ponto de vista de privacidade. Requer o servidor MCP @hocguard/mcp instalado.`,
    steps: SECURE_SHIP_STEPS,
  },
  {
    name: 'guard-map-purposes',
    description: `${MAP_PURPOSES_DESCRIPTION} Use quando o usuário pedir para mapear finalidades, bases legais, o que o app faz com dado pessoal, ou cadastrar finalidades no HOC Guard. Requer o servidor MCP @hocguard/mcp instalado e login (guard_login).`,
    steps: MAP_PURPOSES_STEPS,
  },
];

for (const { name, description, steps } of skills) {
  const skill = `---
name: ${name}
description: ${JSON.stringify(description)}
---

# ${name}

<!-- Gerado de src/workflow.ts por \`npm run gen:skill\`. Não edite à mão. -->

${steps}
`;
  await mkdir(new URL(`../skills/${name}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), skill);
  console.log(`skills/${name}/SKILL.md atualizado`);
}
