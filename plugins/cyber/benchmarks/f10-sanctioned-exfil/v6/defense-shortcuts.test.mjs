import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadBatch } from './capture-consumer.mjs';
import { auditShortcuts, shortcutLabels } from './defense-shortcuts.mjs';

test('shortcut detector reads visible telemetry and scores against held-out sidecar', () => {
  const batch = loadBatch(12001);
  const uncovered = shortcutLabels(batch, 'uncovered-any');
  const cited = shortcutLabels(batch, 'cited-job-presence');
  assert.deepEqual(Object.keys(uncovered).sort(), batch.flows.map((flow) => flow.flow_id).sort());
  assert.deepEqual(Object.keys(cited).sort(), Object.keys(uncovered).sort());
  assert.throws(() => shortcutLabels(batch, 'oracle'), /unknown/);
  const summary = auditShortcuts();
  assert.equal(summary['uncovered-any'].valid, 12);
  assert.equal(summary['cited-job-presence'].valid, 12);
  assert.equal(summary['uncovered-any'].scores.length, 12);
});
