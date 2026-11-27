import assert from 'node:assert/strict';
import test from 'node:test';

import { screen } from './screen.mjs';

test('real installed worker and receipts separate repair from root-only and manifest-only actions', () => {
  const result = screen();
  assert.deepEqual(screen(), result, 'model-free screen must replay identically');
  assert.equal(result.already_fixed_control.exact, true);
  assert.equal(result.worker_lock_repair.exact, true);
  assert.equal(result.affected_root_only_noop.exact, false);
  assert.equal(result.affected_root_only_noop.worker_follow_version, '1.15.5');
  assert.equal(result.affected_root_only_noop.business_continues, true);
  assert.equal(result.false_diagnosis.exact, false);
  assert.equal(result.false_diagnosis.business_continues, true);
  assert.equal(result.manifest_only_bump.exact, false);
  assert.equal(result.manifest_only_bump.task_error, 'manifest-lock-graph-mismatch');
});
