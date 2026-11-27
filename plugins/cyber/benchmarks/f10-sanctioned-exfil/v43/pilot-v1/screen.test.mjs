import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHealthyScreen, screen } from './screen.mjs';

test('real installed worker and receipts separate repair from root-only and manifest-only actions', () => {
  const result = screen();
  assert.deepEqual(screen(), result, 'model-free screen must replay identically');
  assert.equal(result.schema_version, 'f10-v43-transitive-pilot-screen-v1');
  assert.equal(result.already_fixed_control.exact, true);
  assert.equal(result.worker_lock_repair.exact, true);
  assert.equal(result.affected_root_only_noop.exact, false);
  assert.equal(result.affected_root_only_noop.worker_follow_version, '1.15.5');
  assert.equal(result.affected_root_only_noop.business_continues, true);
  assert.equal(result.false_diagnosis.exact, false);
  assert.equal(result.false_diagnosis.business_continues, true);
  assert.equal(result.manifest_only_bump.exact, false);
  assert.equal(result.manifest_only_bump.task_error, 'manifest-lock-graph-mismatch');
  assert.equal(assertHealthyScreen(result), result);
});

test('freeze rejects a host evaluator failure instead of serializing it as a candidate outcome', () => {
  const invalid = {
    already_fixed_control: { exact: false, invalid_reason: 'evaluator_sandbox_failure' },
  };
  assert.throws(() => assertHealthyScreen(invalid), /unhealthy-screen/);
});

test('freeze rejects missing business receipts even when a result claims exact', () => {
  const claimed = {
    already_fixed_control: {
      exact: true,
      invalid_reason: null,
      task_error: null,
      report_delivery: false,
      etl_delivery: true,
    },
    affected_root_only_noop: { invalid_reason: null },
    worker_lock_repair: { invalid_reason: null },
    false_diagnosis: { invalid_reason: null },
    manifest_only_bump: { invalid_reason: null },
  };
  assert.throws(() => assertHealthyScreen(claimed), /unhealthy-screen/);
});
