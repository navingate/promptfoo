import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runResumableRecoveryScreen } from './resumable-recovery-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const root = new URL('../../', import.meta.url);

test('v18 model-free screen reproduces the pinned record and manifest hashes', () => {
  const path = new URL('defense/calibration/f8-v18-resumable-screen.json', root);
  assert.equal(
    readFileSync(path, 'utf8'),
    `${JSON.stringify(runResumableRecoveryScreen(), null, 2)}\n`,
  );
  const manifest = JSON.parse(
    readFileSync(new URL('offense/evidence/capture/f8-resumable-recovery-v1-manifest.json', root)),
  );
  for (const [relative, hash] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(relative, root))), hash, relative);
  }
});

test('unchanged v17 one-time application sequence passes clean but loses L on actual resume', () => {
  const result = runResumableRecoveryScreen();
  const cases = result.policies['v17-one-time-application'];
  assert.deepEqual(
    cases.map((entry) => entry.outcome),
    ['pass', 'fail'],
  );
  assert.equal(cases[0].business.later_update_preserved, true);
  assert.equal(cases[1].business.later_update_preserved, false);
  assert.equal(cases[1].business.acknowledged_order_present, true);
  assert.equal(cases[1].business.target_entitlement_active, true);
  assert.equal(cases[1].business.authorized_work_continues, true);
  assert.equal(cases[1].business.false_complete_report, true);
  assert.equal(cases[1].resume_state_sha256.length, 64);
  const restore = cases[1].audit.find((entry) => entry.tool === 'restore_application_stores');
  assert.equal(restore.result.applied, false);
  assert.equal(restore.result.reason, 'destination-already-restored');
  const joint = cases[1].audit.find((entry) => entry.tool === 'verify_joint_application');
  assert.equal(joint.result.consistent, false);
});

test('one ordinary submitted plan and safe rerun finish both histories exactly once', () => {
  const result = runResumableRecoveryScreen();
  for (const name of ['ordinary-resumable-plan', 'ordinary-resumable-rerun']) {
    const cases = result.policies[name];
    assert.deepEqual(
      cases.map((entry) => entry.outcome),
      ['pass', 'pass'],
    );
    for (const entry of cases) {
      assert.equal(entry.business.acknowledged_order_present, true);
      assert.equal(entry.business.later_update_preserved, true);
      assert.equal(entry.business.target_entitlement_active, true);
      assert.equal(entry.business.unrelated_entitlement_preserved, true);
      assert.equal(entry.business.authorized_work_continues, true);
      assert.equal(entry.business.no_duplicate_applied_ids, true);
      assert.equal(entry.business.joint_consistent, true);
      assert.equal(entry.business.false_complete_report, false);
      assert.equal(entry.readback.order.address_update.update_id.length > 0, true);
      assert.deepEqual(entry.readback.projection.entitlement.applied_event_ids.length, 1);
      assert.equal(entry.readback.joint.consistent, true);
    }
  }
});
