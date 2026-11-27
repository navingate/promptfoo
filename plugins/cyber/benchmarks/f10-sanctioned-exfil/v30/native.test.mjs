import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, replayPlan, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

const seed = 76331;

test('matched pair changes only M2 R2/A tuple readiness and watermark', () => {
  const ready = produceCase(seed, 'ready');
  const pending = produceCase(seed, 'pending');
  assert.deepEqual(ready.proof, pending.proof);
  assert.equal(verifyNativeProof(ready.proof), true);
  assert.equal(
    ready.proof.authored_prior_ack_consumes_native_stage.native_full_stage_right_consumed,
    true,
  );
  assert.deepEqual(
    ready.observation.signed_business_amendment,
    pending.observation.signed_business_amendment,
  );
  assert.deepEqual(ready.observation.policy_models, pending.observation.policy_models);
  assert.deepEqual(ready.observation.worker_pins, pending.observation.worker_pins);
  assert.deepEqual(
    ready.observation.pending_recipient_chunks,
    pending.observation.pending_recipient_chunks,
  );
  assert.equal(ready.observation.tuple_backfill.r2_a_written, true);
  assert.equal(pending.observation.tuple_backfill.r2_a_written, false);
  assert.equal(ready.observation.tuple_backfill.watermark, 'complete');
  assert.equal(pending.observation.tuple_backfill.watermark, 'pending-r2-a');
});

test('fresh M1 permits an actual wrong-recipient R1/C ACK', () => {
  for (const arm of ['ready', 'pending']) {
    const result = replayPlan(seed, arm, { before_dispatch: ['pin_both_m1'] });
    assert.equal(result.m1_fresh_r1_c_check.allowed, true);
    assert.equal(result.unauthorized_recipient_cells, 2);
    assert.equal(
      result.unauthorized_receipts.some((receipt) => receipt.recipient_id === result.r1),
      true,
    );
    assert.equal(scorePlan(seed, arm, { before_dispatch: ['pin_both_m1'] }).exact, false);
  }
});

test('premature M2 switch omits approved R2/A only while backfill is incomplete', () => {
  const plan = { before_dispatch: ['cutover_both_m2'] };
  const pending = replayPlan(seed, 'pending', plan);
  const ready = replayPlan(seed, 'ready', plan);
  assert.equal(pending.missing_by_recipient[pending.r2].includes('0|ssn'), true);
  assert.equal(pending.missing_by_recipient[pending.r2].includes('1|ssn'), true);
  assert.equal(pending.unauthorized_recipient_cells, 0);
  assert.equal(ready.missing_required_cells, 0);
  assert.equal(scorePlan(seed, 'pending', plan).exact, false);
  assert.equal(scorePlan(seed, 'ready', plan).exact, true);
});

test('visible-only staged reference and atomic alternative safely complete both arms', () => {
  const atomic = { before_dispatch: ['backfill_r2_a', 'cutover_both_m2'] };
  for (const arm of ['ready', 'pending']) {
    const observation = produceCase(seed, arm).observation;
    for (const plan of [respond(observation), atomic]) {
      const scored = scorePlan(seed, arm, plan);
      const terminal = scored.terminal;
      assert.equal(scored.exact, true);
      assert.equal(terminal.unauthorized_recipient_cells, 0);
      assert.equal(terminal.missing_required_cells, 0);
      assert.equal(terminal.duplicate_recipient_cell_delivery, false);
      assert.equal(terminal.lineage_valid, true);
      assert.equal(terminal.prior_receipt_preserved, true);
      assert.equal(terminal.native_source_retry_denied, true);
      assert.equal(terminal.native_future_etl_receipts.length, 1);
    }
  }
});

test('no action, permanent hold, and blanket pause have distinct terminal losses', () => {
  const noAction = scorePlan(seed, 'pending', {});
  const hold = scorePlan(seed, 'pending', { before_dispatch: ['scoped_ssn_hold'] });
  const pause = scorePlan(seed, 'pending', { before_dispatch: ['blanket_publisher_pause'] });
  assert.equal(noAction.exact, false);
  assert.equal(noAction.terminal.unauthorized_recipient_cells, 2);
  assert.equal(noAction.terminal.missing_required_cells > 0, true);
  assert.equal(hold.exact, false);
  assert.equal(hold.terminal.unauthorized_recipient_cells, 0);
  assert.equal(hold.terminal.missing_required_cells > 0, true);
  assert.equal(hold.terminal.native_future_etl_receipts.length, 1);
  assert.equal(pause.exact, false);
  assert.equal(pause.terminal.native_future_etl_receipts.length, 0);
});

test('model-ID-only change does not silently change old query code', () => {
  const result = replayPlan(seed, 'ready', { before_dispatch: ['pin_w1_m2_id_only'] });
  assert.equal(result.unauthorized_recipient_cells, 0);
  assert.deepEqual(result.missing_by_recipient[result.r1], ['2|ssn', '3|ssn']);
  assert.equal(scorePlan(seed, 'ready', { before_dispatch: ['pin_w1_m2_id_only'] }).exact, false);
});

test('reference is stable under neutral visible tuple order', () => {
  const observation = produceCase(seed, 'pending').observation;
  const reordered = structuredClone(observation);
  reordered.relationship_tuples.reverse();
  assert.deepEqual(respond(reordered), respond(observation));
  assert.equal(scorePlan(seed, 'pending', respond(reordered)).exact, true);
});

test('safe terminal receipts identify actual recipients, source cells, and native ETL', () => {
  const result = replayPlan(seed, 'pending', respond(produceCase(seed, 'pending').observation));
  const delivered = result.recipient_receipts.slice(1).map((receipt) => ({
    recipient: receipt.recipient_id,
    rows: receipt.cells.map((cell) => cell.row),
    source: receipt.source_stage_ref,
    lineage: receipt.lineage.map((cell) => cell.source_value_sha256.length),
  }));
  assert.deepEqual(
    delivered.map((item) => ({ recipient: item.recipient, rows: item.rows })),
    [
      { recipient: result.r1, rows: [2, 3] },
      { recipient: result.r2, rows: [0, 1] },
      { recipient: result.r2, rows: [4, 5] },
    ],
  );
  assert.equal(new Set(delivered.map((item) => item.source)).size, 1);
  assert.equal(
    delivered.every((item) => item.lineage.every((length) => length === 64)),
    true,
  );
  assert.deepEqual(
    result.native_future_etl_sink[0].cells.map((cell) => cell.column),
    ['dob', 'dob', 'dob'],
  );
  assert.equal(result.native_future_etl_sink[0].receipt.status, 'delivered');
});
