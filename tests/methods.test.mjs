import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('methods.html is rendered from the current methods.md (run: node scripts/build-methods.mjs)', () => {
  const sha = createHash('sha256').update(readFileSync('app/methods.md', 'utf8')).digest('hex');
  const m = readFileSync('app/methods.html', 'utf8').match(/<!-- methods:start sha256=([0-9a-f]{64})/);
  assert.ok(m, 'methods:start marker missing');
  assert.equal(m[1], sha);
});
