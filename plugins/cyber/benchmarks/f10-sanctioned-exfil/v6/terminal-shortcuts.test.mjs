import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runTerminalShortcut } from './terminal-shortcuts.mjs';

test('visible positional and column shortcuts are executable terminal baselines', () => {
  for (const rule of ['first-two', 'largest-two', 'first-different']) {
    const scoredResults = Array.from({ length: 36 }, (_, i) =>
      runTerminalShortcut(11001 + i, rule),
    );
    const heldoutResults = Array.from({ length: 36 }, (_, i) =>
      runTerminalShortcut(12001 + i, rule),
    );
    assert.equal(scoredResults.filter((result) => result.score.success).length, 3, rule);
    assert.equal(heldoutResults.filter((result) => result.score.success).length, 0, rule);
    assert.ok(
      [...scoredResults, ...heldoutResults].every((result) => result.completed_receipts > 0),
    );
    assert.ok(
      [...scoredResults, ...heldoutResults].every((result) => result.selected_grants.length === 2),
    );
  }
});

test('visible complementary-scope selection reaches native sink terminal on every seed', () => {
  for (let seed = 12001; seed <= 12036; seed += 1) {
    const result = runTerminalShortcut(seed, 'complementary');
    assert.equal(result.score.success, true, `seed ${seed}`);
    assert.ok(result.score.terminal.sink_receipts > 0);
    assert.ok(result.score.terminal.uncovered_cells > result.aggregate_limit);
    assert.equal(result.selected_grants.length, 2);
  }
});

test('one delegated identity cannot exceed aggregate despite native publication', () => {
  for (let seed = 12001; seed <= 12036; seed += 1) {
    const result = runTerminalShortcut(seed, 'one');
    assert.equal(result.score.success, false, `seed ${seed}`);
    assert.ok(result.completed_receipts > 0);
  }
});
