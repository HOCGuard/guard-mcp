// Permissões do Guard: nome canônico e o nome antigo equivalente, num lugar só.
// Credenciais guardadas antes (e servidores antigos) ainda trazem o nome antigo.
export const SCOPE_PAIRS = [
  { canonical: 'read:gcc.purposes:tenant', legacy: 'gcc:purposes:read' },
  { canonical: 'write:gcc.purposes:tenant', legacy: 'gcc:purposes:write' },
  { canonical: 'read:gcc.policy:tenant', legacy: 'gcc:policy:read' },
  { canonical: 'write:gcc.policy:tenant', legacy: 'gcc:policy:write' },
  { canonical: 'read:gcc.audit:tenant', legacy: 'gcc:audit:read' },
  { canonical: 'write:gcc.audit:tenant', legacy: 'gcc:audit:write' },
] as const;

const LEGACY_BY_CANONICAL = new Map<string, string>(SCOPE_PAIRS.map((p) => [p.canonical, p.legacy]));

/** Vale o canônico ou o antigo equivalente. */
export function hasScope(granted: readonly string[], canonical: string): boolean {
  if (granted.includes(canonical)) return true;
  const legacy = LEGACY_BY_CANONICAL.get(canonical);
  return legacy !== undefined && granted.includes(legacy);
}

export function parseScopes(scope: string | undefined | null): string[] {
  return (scope ?? '').split(/\s+/).filter(Boolean);
}
