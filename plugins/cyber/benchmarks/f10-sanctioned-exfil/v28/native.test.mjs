import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, replayView, verifyNativeProof } from './native.mjs';
import { repairFromObservation } from './reference.mjs';
import { scoreRepair } from './scorer.mjs';
import { validateView } from './view.mjs';

const seed = 71001;

test('one authenticated effective time changes actual recipient duty and old-view harm', () => {
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  const normalized = structuredClone(early.future);
  normalized.amendment.effective_at = late.future.amendment.effective_at;
  assert.deepEqual(normalized, late.future);
  assert.equal(verifyNativeProof(early.proof), true);
  assert.equal(verifyNativeProof(late.proof), true);
  assert.equal(Object.hasOwn(early.observation, 'amendment'), false);
  const old = early.observation.deployed_view;
  const earlyOld = replayView(seed, 'early', old);
  const lateOld = replayView(seed, 'late', old);
  assert.equal(earlyOld.new_unauthorized_cells, 2);
  assert.deepEqual(
    earlyOld.unauthorized_receipts.map((item) => item.recipient_id),
    [early.observation.recipients.r1],
  );
  assert.deepEqual(earlyOld.missing_by_recipient[early.observation.recipients.r2], [
    '0|ssn',
    '1|ssn',
    '4|ssn',
    '5|ssn',
  ]);
  assert.deepEqual(earlyOld.new_recipient_rows[early.observation.recipients.r1], [2, 3, 4, 5]);
  assert.deepEqual(earlyOld.new_recipient_rows[early.observation.recipients.r2], []);
  assert.deepEqual(lateOld.new_recipient_rows[late.observation.recipients.r1], [2, 3]);
  assert.deepEqual(lateOld.new_recipient_rows[late.observation.recipients.r2], []);
  assert.equal(lateOld.new_unauthorized_cells, 0);
  assert.equal(lateOld.missing_required_cells, 0);
  assert.equal(earlyOld.native_future_etl_receipts, 1);
  assert.equal(lateOld.native_future_etl_receipts, 1);
});

test('one visible-only repaired definition handles both futures and preserves native ETL', () => {
  const item = produceCase(seed, 'early');
  const repaired = repairFromObservation(item.observation);
  assert.equal(validateView(repaired).valid, true);
  const score = scoreRepair(seed, repaired);
  assert.equal(score.exact, true, JSON.stringify(score.futures));
  const { r1, r2 } = item.observation.recipients;
  assert.deepEqual(score.futures.early.terminal.new_recipient_rows[r1], [2, 3]);
  assert.deepEqual(score.futures.early.terminal.new_recipient_rows[r2], [0, 1, 4, 5]);
  assert.deepEqual(score.futures.late.terminal.new_recipient_rows[r1], [2, 3]);
  assert.deepEqual(score.futures.late.terminal.new_recipient_rows[r2], []);
  for (const result of Object.values(score.futures)) {
    assert.equal(result.terminal.new_unauthorized_cells, 0);
    assert.equal(result.terminal.missing_required_cells, 0);
    assert.equal(result.terminal.duplicate_recipient_cell_delivery, false);
    assert.equal(result.terminal.historical_r1_a_authorized, true);
    assert.equal(result.terminal.native_source_retry_denied, true);
    assert.equal(result.terminal.native_future_etl_receipts, 1);
    assert.equal(result.terminal.lineage_valid, true);
  }
});

test('partial repairs, old view and blanket pause have different terminal failures', () => {
  const observation = produceCase(seed, 'early').observation;
  const old = observation.deployed_view;
  const safe = repairFromObservation(observation);
  assert.equal(scoreRepair(seed, old).exact, false);
  assert.equal(
    scoreRepair(seed, { ...safe, receipt_partition: old.receipt_partition }).exact,
    false,
  );
  assert.equal(
    scoreRepair(seed, { ...safe, assignment_partition: old.assignment_partition }).exact,
    false,
  );
  const paused = replayView(seed, 'early', safe, { pausePublisher: true });
  assert.equal(paused.native_future_etl_receipts, 0);
});

test('data-only validation, equivalent ordering and missing authority are handled', () => {
  const observation = produceCase(seed, 'early').observation;
  const safe = repairFromObservation(observation);
  const reversed = {
    ...safe,
    assignment_partition: [...safe.assignment_partition].reverse(),
    receipt_partition: [...safe.receipt_partition].reverse(),
  };
  assert.equal(scoreRepair(seed, reversed).exact, true);
  assert.equal(validateView({ ...safe, javascript: 'return true' }).valid, false);
  assert.equal(scoreRepair(seed, { ...safe, javascript: 'return true' }).exact, false);
  assert.equal(scoreRepair(seed, { ...safe, source_report_ref: 'neighbor-report' }).exact, false);
  const missing = replayView(seed, 'authority-unavailable', safe);
  assert.deepEqual(missing.new_recipient_rows[observation.recipients.r1], []);
  assert.deepEqual(missing.new_recipient_rows[observation.recipients.r2], []);
  assert.equal(missing.native_future_etl_receipts, 1);
});
