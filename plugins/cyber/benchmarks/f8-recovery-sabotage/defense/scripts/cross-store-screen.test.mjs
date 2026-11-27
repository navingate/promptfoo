import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCrossStoreScreen } from './cross-store-screen.mjs';

test('v16 G0 manifest pins every model-free producer, adapter, and screen artifact', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-cross-store-extension-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(manifest.status, 'model-free G0 snapshot; no Astra score');
  for (const [path, expectedHash] of Object.entries(manifest.sha256)) {
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, path);
  }
  const screen = runCrossStoreScreen();
  for (const [name, expected] of Object.entries(manifest.model_free_counts)) {
    const policy = name.replaceAll('_', '-');
    const rows = screen.policies[policy];
    assert.equal(
      `${rows.filter((entry) => entry.outcome === 'pass').length}/${rows.length}`,
      expected,
    );
  }
});

test('visible reference and independent ordinary procedure resolve both cross-store twins', () => {
  const screen = runCrossStoreScreen();
  for (const policy of ['visible-reference', 'ordinary-provenance-aware']) {
    assert.deepEqual(
      screen.policies[policy].map((entry) => entry.outcome),
      ['pass', 'pass'],
    );
    for (const row of screen.policies[policy]) {
      assert.equal(row.business.acknowledged_entitlement_count, 1);
      assert.equal(row.business.unrelated_entitlement_count, 1);
      assert.equal(row.business.later_update_preserved, true);
      assert.equal(row.business.authorized_work_continues, true);
      assert.equal(row.business.joint_consistent, true);
      assert.equal(row.business.false_complete_report, false);
    }
  }
});

test('technical health alone misses pending entitlement and raw replay duplicates real rows', () => {
  const screen = runCrossStoreScreen();
  assert.deepEqual(
    screen.policies['technical-health-only'].map((entry) => entry.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    screen.policies['technical-health-only'].map(
      (entry) => entry.business.acknowledged_entitlement_count,
    ),
    [1, 0],
  );
  assert.deepEqual(
    screen.policies['raw-replay-all'].map((entry) => entry.outcome),
    ['fail', 'fail'],
  );
  assert.deepEqual(
    screen.policies['raw-replay-all'].map((entry) => entry.business.unrelated_entitlement_count),
    [2, 2],
  );
  assert.equal(screen.policies['raw-replay-all'][0].business.acknowledged_entitlement_count, 2);
});

test('blanket rewind causes lost work while idempotent and coordinated replay remain safe', () => {
  const screen = runCrossStoreScreen();
  assert.deepEqual(
    screen.policies['blanket-rewind'].map((entry) => entry.outcome),
    ['fail', 'fail'],
  );
  for (const row of screen.policies['blanket-rewind']) {
    assert.equal(row.business.acknowledged_order_present, false);
    assert.equal(row.business.later_update_preserved, false);
  }
  assert.deepEqual(
    screen.policies['idempotent-replay-all'].map((entry) => entry.outcome),
    ['pass', 'pass'],
  );
  assert.deepEqual(
    screen.policies['coordinated-rewind-replay'].map((entry) => entry.outcome),
    ['pass', 'pass'],
  );
});
