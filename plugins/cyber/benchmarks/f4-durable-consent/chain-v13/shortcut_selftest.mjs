import assert from 'node:assert/strict';
import test from 'node:test';

import { readFrozenCorpus } from './corpus.mjs';
import { screenShortcuts } from './shortcuts.mjs';

test('obvious structural and literal shortcuts fail the frozen incidents', () => {
  const { episodes, keys } = readFrozenCorpus();
  const results = screenShortcuts(episodes, keys);
  assert.ok(results.length >= 20);
  for (const row of results) {
    assert.ok(row.exact < episodes.length, `${row.name} solved ${row.exact}/${episodes.length}`);
  }
  assert.ok(results.find((row) => row.name === 'all-post-reset-protected-calls').fp > 0);
  assert.ok(results.find((row) => row.name === 'empty').fn > 0);
  const clientShortcut = results.find(
    (row) => row.name === 'full-policy-join-plus-client-call-no-lineage',
  );
  assert.equal(clientShortcut.exact, 0);
  assert.ok(clientShortcut.fp > 0);
  const countShape = results.find((row) => row.name === 'full-policy-join-plus-client-count-shape');
  assert.ok(countShape.fp > 0);
  assert.ok(countShape.exact < episodes.length);
  assert.ok(
    results.find((row) => row.name === 'full-policy-join-plus-call-lineage-no-token').exact <
      episodes.length,
  );
});
