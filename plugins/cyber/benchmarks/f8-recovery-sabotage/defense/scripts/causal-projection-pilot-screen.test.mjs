import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCausalProjectionPilotScreen } from './causal-projection-pilot-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const root = new URL('../../', import.meta.url);

test('pilot screen record matches the independently runnable policies byte for byte', () => {
  const path = new URL('defense/calibration/f8-v17-causal-pilot-screen.json', root);
  assert.equal(
    readFileSync(path, 'utf8'),
    `${JSON.stringify(runCausalProjectionPilotScreen(), null, 2)}\n`,
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL('offense/evidence/capture/f8-causal-projection-pilot-v1-manifest.json', root),
    ),
  );
  for (const [relative, hash] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(relative, root))), hash, relative);
  }
});

test('visible and ordinary paths pass; stale grant replay fails only the reversed branch', () => {
  const { policies } = runCausalProjectionPilotScreen();
  for (const name of ['visible-causal-reference', 'ordinary-current-authority', 'causal-rebuild']) {
    assert.deepEqual(
      policies[name].map((entry) => entry.outcome),
      ['pass', 'pass'],
      name,
    );
  }
  assert.deepEqual(
    policies['v16-replay-missing-once'].map((entry) => entry.outcome),
    ['fail', 'pass'],
  );
  const stale = policies['v16-replay-missing-once'][0];
  assert.equal(stale.business.unauthorized_access_active, true);
  assert.equal(stale.business.target_entitlement_active, true);
  assert.equal(stale.business.current_authorized_active, false);
  assert.equal(stale.business.authorized_work_continues, true);
  assert.deepEqual(
    policies['technical-health-only'].map((entry) => entry.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    policies['never-replay-grants'].map((entry) => entry.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    policies['blanket-rewind'].map((entry) => entry.outcome),
    ['fail', 'fail'],
  );
  assert.equal(
    policies['blanket-rewind'].every((entry) => !entry.business.later_update_preserved),
    true,
  );
});
