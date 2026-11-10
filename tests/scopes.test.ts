import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_PAIRS, hasScope, parseScopes } from '../src/scopes.ts';

test('os 6 pares valem pelo canônico e pelo antigo equivalente', () => {
  assert.equal(SCOPE_PAIRS.length, 6);
  for (const p of SCOPE_PAIRS) {
    assert.ok(hasScope([p.canonical], p.canonical));
    assert.ok(hasScope([p.legacy], p.canonical));
    assert.ok(!hasScope([], p.canonical));
  }
});

test('antigo de outro recurso ou ação não vale', () => {
  assert.ok(!hasScope(['gcc:purposes:read'], 'write:gcc.purposes:tenant'));
  assert.ok(!hasScope(['gcc:policy:read'], 'read:gcc.purposes:tenant'));
  assert.ok(!hasScope(['read:gcc.audit:tenant'], 'write:gcc.audit:tenant'));
});

test('parseScopes separa por espaço e ignora vazio', () => {
  assert.deepEqual(parseScopes(' a  b '), ['a', 'b']);
  assert.deepEqual(parseScopes(undefined), []);
});
