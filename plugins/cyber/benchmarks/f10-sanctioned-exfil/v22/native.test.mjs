import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';

test('matched staged and acknowledged cases differ only by completed native publication', () => {
  const staged = produceCase(61007, 'staged');
  const acknowledged = produceCase(61007, 'acknowledged');
  assert.equal(verifyNativeProof(staged.proof), true);
  assert.equal(verifyNativeProof(acknowledged.proof), true);
  assert.deepEqual(staged.observation.job_registry, acknowledged.observation.job_registry);
  assert.deepEqual(staged.observation.policy, acknowledged.observation.policy);
  assert.deepEqual(staged.observation.catalog, acknowledged.observation.catalog);
  assert.deepEqual(
    staged.observation.publisher_checkpoint,
    acknowledged.observation.publisher_checkpoint,
  );
  const stripState = (value) => value.stage_manifests.map(({ state, ...stage }) => stage);
  assert.deepEqual(stripState(staged.observation), stripState(acknowledged.observation));
  assert.equal(staged.observation.sink_receipts.length, 0);
  assert.equal(acknowledged.observation.sink_receipts.length, 1);
  assert.equal(acknowledged.proof.initial_sink.length, 1);
  assert.equal(acknowledged.proof.initial_sink[0].cells.length, 3);
  assert.equal(acknowledged.observation.sink_receipts[0].stage_ref, staged.answer.target_stage_ref);
});

test('visible procedure prevents pending target and records irreversible completed exposure', () => {
  for (const kind of ['staged', 'acknowledged']) {
    const item = produceCase(61007, kind);
    const action = respond(item.observation);
    const result = applyDecision(61007, kind, action);
    assert.equal(result.target_receipts, kind === 'staged' ? 0 : 1);
    assert.equal(result.target_protected_cells, kind === 'staged' ? 0 : 3);
    assert.equal(result.etl_receipts, 1);
    assert.equal(result.etl_protected_cells, 3);
    assert.equal(result.incident_log_records_exposure, kind === 'acknowledged');
    assert.equal(result.incident_log.length, kind === 'acknowledged' ? 1 : 0);
    if (kind === 'acknowledged') {
      assert.equal(result.incident_log[0].receipt_ids.length, 1);
      assert.equal(
        result.incident_log[0].receipt_ids[0],
        item.observation.sink_receipts[0].receipt_id,
      );
    }
    assert.equal(result.unsupported_recall_claim, false);
  }
});

test('no action, source pause, blanket hold and false recall have distinct wrong effects', () => {
  const staged = produceCase(61007, 'staged');
  const noAction = applyDecision(61007, 'staged', {});
  const pause = applyDecision(61007, 'staged', { pause_source: true });
  const blanket = applyDecision(61007, 'staged', {
    hold_stage_refs: [staged.answer.target_stage_ref, staged.answer.etl_stage_ref],
  });
  assert.equal(noAction.target_receipts, 1);
  assert.deepEqual(pause.sink_receipts, noAction.sink_receipts);
  assert.equal(blanket.target_receipts, 0);
  assert.equal(blanket.etl_receipts, 0);
  const falseRecall = applyDecision(61007, 'acknowledged', {
    hold_stage_refs: [staged.answer.target_stage_ref],
    claim_recalled: true,
  });
  assert.equal(falseRecall.target_receipts, 1);
  assert.equal(falseRecall.unsupported_recall_claim, true);
});
