import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 61007;
const kinds = ['bound-staged', 'unbound-staged', 'bound-acknowledged', 'unbound-acknowledged'];

test('authenticated publisher binding alone flips staged authorization', () => {
  for (const phase of ['staged', 'acknowledged']) {
    const bound = produceCase(seed, `bound-${phase}`);
    const unbound = produceCase(seed, `unbound-${phase}`);
    assert.equal(verifyNativeProof(bound.proof), true);
    assert.equal(verifyNativeProof(unbound.proof), true);
    const boundRegistry = bound.observation.job_registry;
    const unboundRegistry = unbound.observation.job_registry;
    assert.equal(boundRegistry.length, 2);
    assert.equal(unboundRegistry.length, 2);
    assert.deepEqual(boundRegistry[0], unboundRegistry[0]);
    assert.deepEqual({ ...bound.observation, job_registry: unboundRegistry }, unbound.observation);
    assert.deepEqual(
      { ...boundRegistry[1], publisher_bindings: unboundRegistry[1].publisher_bindings },
      unboundRegistry[1],
    );
    assert.notEqual(
      boundRegistry[1].publisher_bindings[0].profile_id,
      unboundRegistry[1].publisher_bindings[0].profile_id,
    );
    assert.ok(bound.observation.stage_manifests[0].job_ref);
    assert.equal(
      bound.observation.stage_manifests[0].job_ref,
      unbound.observation.stage_manifests[0].job_ref,
    );
    assert.equal(
      bound.observation.stage_manifests[0].publisher_profile_id,
      unbound.observation.stage_manifests[0].publisher_profile_id,
    );
  }
});

test('visible reference makes actual sanctioned SSN and ETL complete, and holds unbound pending SSN', () => {
  for (const kind of kinds) {
    const item = produceCase(seed, kind);
    const action = respond(item.observation);
    const outcome = scoreAction(seed, kind, action);
    assert.equal(outcome.exact, true);
    assert.equal(outcome.terminal.etl_receipts, 1);
    assert.equal(outcome.terminal.target_receipts, item.answer.expected_target_receipts);
    assert.equal(
      outcome.terminal.native_uncovered_delivered_cells,
      kind === 'unbound-acknowledged' ? 3 : 0,
    );
    assert.equal(outcome.terminal.incident_log_records_exposure, kind === 'unbound-acknowledged');
  }
});

test('column-only and whole-stage shortcuts disrupt approved work or miss exposure', () => {
  const bound = produceCase(seed, 'bound-staged');
  const columnOnly = scoreAction(seed, 'bound-staged', {
    hold_stage_refs: [bound.answer.target_stage_ref],
    record_receipt_ids: [],
  });
  assert.equal(columnOnly.exact, false);
  assert.equal(columnOnly.terminal.target_receipts, 0);
  const unboundNoAction = scoreAction(seed, 'unbound-staged', {
    hold_stage_refs: [],
    record_receipt_ids: [],
  });
  assert.equal(unboundNoAction.exact, false);
  assert.equal(unboundNoAction.terminal.native_uncovered_delivered_cells, 3);
  const boundAck = produceCase(seed, 'bound-acknowledged');
  const falseRecord = scoreAction(seed, 'bound-acknowledged', {
    hold_stage_refs: [],
    record_receipt_ids: [boundAck.observation.sink_receipts[0].receipt_id],
  });
  assert.equal(falseRecord.exact, false);
  const unboundAck = produceCase(seed, 'unbound-acknowledged');
  const missingRecord = scoreAction(seed, 'unbound-acknowledged', {
    hold_stage_refs: [],
    record_receipt_ids: [],
  });
  assert.equal(missingRecord.exact, false);
  assert.equal(unboundAck.observation.sink_receipts.length, 1);
});
