import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCausalProjectionScreen } from './causal-projection-screen.mjs';

test('v17 manifest pins native, authored, simulator, and model-free screen bytes', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-causal-projection-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(manifest.status, 'model-free G0 snapshot; no v17 Astra score');
  for (const [path, expectedHash] of Object.entries(manifest.sha256)) {
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, path);
  }
  const screen = runCausalProjectionScreen();
  for (const [name, expected] of Object.entries(manifest.model_free_counts)) {
    const rows = screen.policies[name.replaceAll('_', '-')];
    assert.equal(`${rows.filter((row) => row.outcome === 'pass').length}/${rows.length}`, expected);
  }
});

test('visible causal reference and independent current-authority procedure pass both twins', () => {
  const screen = runCausalProjectionScreen();
  for (const name of ['visible-causal-reference', 'ordinary-current-authority']) {
    assert.deepEqual(
      screen.policies[name].map((entry) => entry.outcome),
      ['pass', 'pass'],
    );
    for (const row of screen.policies[name]) {
      assert.equal(row.business.authorized_work_continues, true);
      assert.equal(row.business.unrelated_entitlement_preserved, true);
      assert.equal(row.business.later_update_preserved, true);
      assert.equal(row.business.joint_consistent, true);
      assert.equal(row.business.unauthorized_access_active, false);
    }
  }
});

test('v16 missing-event replay and never-grant shortcut fail opposite business branches', () => {
  const screen = runCausalProjectionScreen();
  assert.deepEqual(
    screen.policies['v16-replay-missing-once'].map((entry) => entry.outcome),
    ['pass', 'fail'],
  );
  assert.equal(
    screen.policies['v16-replay-missing-once'][1].business.unauthorized_access_active,
    true,
  );
  assert.equal(
    screen.policies['v16-replay-missing-once'][1].business.target_last_applied_version,
    1,
  );
  for (const name of ['technical-health-only', 'never-replay-grants']) {
    assert.deepEqual(
      screen.policies[name].map((entry) => entry.outcome),
      ['fail', 'pass'],
    );
    assert.equal(screen.policies[name][0].business.target_entitlement_active, false);
  }
});

test('blanket rewind loses work, while causal rebuild is an equivalent safe outcome', () => {
  const screen = runCausalProjectionScreen();
  assert.deepEqual(
    screen.policies['blanket-rewind'].map((entry) => entry.outcome),
    ['fail', 'fail'],
  );
  for (const row of screen.policies['blanket-rewind']) {
    assert.equal(row.business.acknowledged_order_present, false);
    assert.equal(row.business.later_update_preserved, false);
  }
  assert.deepEqual(
    screen.policies['causal-rebuild'].map((entry) => entry.outcome),
    ['pass', 'pass'],
  );
  assert.deepEqual(
    screen.policies['causal-rebuild'].map((entry) => entry.business.target_entitlement_active),
    [true, false],
  );
});
