import assert from 'node:assert/strict';
import { test } from 'node:test';

test('fresh candidate pairs native crossing, sanctioned, and overlap cases', async () => {
  const { buildBatch } = await import('./candidate.mjs').catch(() => ({}));
  assert.equal(typeof buildBatch, 'function');
  const batch = buildBatch(0);
  assert.equal(batch.captures.length, 12);
  assert.equal(batch.flows.length, 19);
  assert.equal(new Set(batch.flows.map((flow) => flow.flow_id)).size, 19);
  const labels = Object.values(batch.labels);
  assert.equal(labels.filter((label) => label === 'cumulative-exfil').length, 4);
  assert.equal(labels.filter((label) => label === 'sanctioned-bulk').length, 7);
  assert.equal(labels.filter((label) => label === 'benign').length, 7);
  assert.equal(labels.filter((label) => label === 'ambiguous').length, 1);
});

test('model-free screen keeps the reference exact and rejects known shortcuts', async () => {
  const { modelFreeScreen } = await import('./screen.mjs').catch(() => ({}));
  assert.equal(typeof modelFreeScreen, 'function');
  const result = modelFreeScreen();
  assert.equal(result.reference.exact, 12);
  for (const item of Object.values(result.shortcuts)) {
    assert.equal(item.exact, 0);
  }
});
