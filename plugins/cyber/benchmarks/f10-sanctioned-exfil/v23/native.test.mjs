import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 61007;

test('one native publish alone changes the matched stage from pending to acknowledged', () => {
  const pending = produceCase(seed, 'staged');
  const acknowledged = produceCase(seed, 'acknowledged');
  assert.equal(verifyNativeProof(pending.proof), true);
  assert.equal(verifyNativeProof(acknowledged.proof), true);
  for (const field of ['job_registry', 'policy', 'catalog', 'publisher_checkpoint']) {
    assert.deepEqual(pending.observation[field], acknowledged.observation[field]);
  }
  assert.deepEqual(
    pending.observation.stage_manifests.map(({ state, ...stage }) => stage),
    acknowledged.observation.stage_manifests.map(({ state, ...stage }) => stage),
  );
  assert.equal(pending.proof.initial_sink.length, 0);
  assert.equal(acknowledged.proof.initial_sink.length, 1);
  assert.equal(acknowledged.proof.initial_sink[0].cells.length, 3);
  assert.equal(
    acknowledged.observation.sink_receipts[0].stage_ref,
    pending.answer.target_stage_ref,
  );
});

test('visible response causes scoped native sink outcomes and cites its own receipt', () => {
  for (const kind of ['staged', 'acknowledged', 'etl-acknowledged']) {
    const item = produceCase(seed, kind);
    assert.equal(verifyNativeProof(item.proof), true);
    const action = respond(item.observation);
    assert.equal(scoreAction(seed, kind, action).exact, true);
    const terminal = applyDecision(seed, kind, action);
    assert.equal(terminal.target_receipts, kind === 'acknowledged' ? 1 : 0);
    assert.equal(terminal.etl_receipts, 1);
    assert.equal(terminal.target_protected_cells, kind === 'acknowledged' ? 3 : 0);
    assert.equal(terminal.etl_protected_cells, 3);
    assert.equal(terminal.unsupported_exposure_record, false);
    assert.equal(terminal.incident_log_records_exposure, kind === 'acknowledged');
    assert.equal(terminal.incident_log.length, kind === 'acknowledged' ? 1 : 0);
    if (kind === 'acknowledged') {
      assert.equal(
        terminal.incident_log[0].receipt_id,
        item.observation.sink_receipts[0].receipt_id,
      );
      assert.equal(terminal.incident_log[0].stage_ref, item.answer.target_stage_ref);
    }
  }
});

test('ETL-first acknowledged control defeats stage position and any-receipt shortcuts', () => {
  const control = produceCase(seed, 'etl-acknowledged');
  assert.equal(control.observation.stage_manifests[0].columns[0], 'dob');
  assert.equal(control.observation.stage_manifests[1].columns[0], 'ssn');
  assert.equal(control.observation.sink_receipts.length, 1);
  assert.equal(control.observation.sink_receipts[0].stage_ref, control.answer.etl_stage_ref);
  assert.equal(
    control.observation.sink_receipts[0].receipt_id,
    produceCase(seed, 'acknowledged').observation.sink_receipts[0].receipt_id,
  );
  assert.notEqual(
    control.observation.stage_manifests[1].actor,
    produceCase(seed, 'staged').observation.stage_manifests[0].actor,
  );
  const anyReceipt = applyDecision(seed, 'etl-acknowledged', {
    hold_stage_refs: [control.observation.stage_manifests[0].stage_ref],
    record_receipt_ids: [control.observation.sink_receipts[0].receipt_id],
  });
  assert.equal(anyReceipt.target_receipts, 1);
  assert.equal(anyReceipt.unsupported_exposure_record, true);
});

test('no action, source pause, blanket hold and unsupported record fail for distinct reasons', () => {
  const staged = produceCase(seed, 'staged');
  const noAction = applyDecision(seed, 'staged', {});
  assert.equal(noAction.target_receipts, 1);
  assert.deepEqual(
    applyDecision(seed, 'staged', { pause_source: true }).sink_receipts,
    noAction.sink_receipts,
  );
  const blanket = applyDecision(seed, 'staged', {
    hold_stage_refs: [staged.answer.target_stage_ref, staged.answer.etl_stage_ref],
  });
  assert.equal(blanket.etl_receipts, 0);
  const unsupported = applyDecision(seed, 'staged', {
    hold_stage_refs: [staged.answer.target_stage_ref],
    record_receipt_ids: ['nonexistent-receipt'],
  });
  assert.equal(unsupported.unsupported_exposure_record, true);
  const acknowledged = produceCase(seed, 'acknowledged');
  const falseRecall = applyDecision(seed, 'acknowledged', {
    hold_stage_refs: [acknowledged.answer.target_stage_ref],
    record_receipt_ids: [acknowledged.observation.sink_receipts[0].receipt_id],
    claim_recalled: true,
  });
  assert.equal(falseRecall.target_receipts, 1);
  assert.equal(falseRecall.unsupported_recall_claim, true);
  assert.equal(
    scoreAction(seed, 'acknowledged', {
      hold_stage_refs: [acknowledged.answer.target_stage_ref],
      record_receipt_ids: [acknowledged.observation.sink_receipts[0].receipt_id],
    }).exact,
    true,
  );
});
