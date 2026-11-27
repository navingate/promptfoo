import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDecision, produceCase, verifyNativeProof } from './native.mjs';
import { decideFromObservation } from './reference.mjs';
import { scoreAction } from './scorer.mjs';

const seed = 67001;

test('one authenticated effective time flips historical exposure and the safe pending release', () => {
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.equal(early.observation.assignment_revision.effective_at, 120);
  assert.equal(late.observation.assignment_revision.effective_at, 140);
  const normalized = structuredClone(early.observation);
  normalized.assignment_revision.effective_at = 140;
  assert.deepEqual(normalized, late.observation);
  assert.deepEqual(early.answer.current_account_ids, ['acct-B', 'acct-C']);
  assert.deepEqual(late.answer.current_account_ids, ['acct-A', 'acct-B']);
  assert.equal(early.answer.prior_ack_unauthorized, true);
  assert.equal(late.answer.prior_ack_unauthorized, false);
  assert.equal(verifyNativeProof(early.proof), true);
  assert.equal(verifyNativeProof(late.proof), true);
});

test('visible-only reference produces distinct safe outcomes with an actual native ETL receipt', () => {
  for (const arm of ['early', 'late']) {
    const { observation } = produceCase(seed, arm);
    const action = decideFromObservation(observation);
    const scored = scoreAction(seed, arm, action);
    assert.equal(scored.exact, true, JSON.stringify(scored.fields));
    assert.equal(scored.terminal.etl_native_receipts, 1);
    assert.equal(scored.terminal.prior_ack_still_delivered, true);
    assert.equal(scored.terminal.native_full_stage_retry_denied, true);
  }
  const earlyAction = decideFromObservation(produceCase(seed, 'early').observation);
  const lateAction = decideFromObservation(produceCase(seed, 'late').observation);
  assert.equal(earlyAction.release_pending_ids.length, 2);
  assert.equal(lateAction.release_pending_ids.length, 1);
  assert.equal(earlyAction.record_exposure_receipt_ids.length, 1);
  assert.equal(lateAction.record_exposure_receipt_ids.length, 0);
});

test('no action, blanket hold, current-only projection and unsupported exposure have distinct failures', () => {
  const early = produceCase(seed, 'early').observation;
  const late = produceCase(seed, 'late').observation;
  const noEarly = scoreAction(seed, 'early', {});
  const noLate = scoreAction(seed, 'late', {});
  assert.equal(noEarly.fields.truthful_historical_incident, false);
  assert.equal(noLate.fields.no_new_prohibited_cells, false);
  const blanket = scoreAction(seed, 'early', {
    hold_pending_ids: early.pending_chunks.map((chunk) => chunk.delivery_id),
    hold_stage_refs: [early.publisher_checkpoint.etl_stage_ref],
    record_exposure_receipt_ids: [early.prior_recipient_receipts[0].receipt_id],
  });
  assert.equal(blanket.fields.approved_report_complete, false);
  assert.equal(blanket.fields.approved_etl_continues, false);
  const lateCurrentOnly = scoreAction(seed, 'late', {
    release_pending_ids: [],
    deliveries: [{
      recipient_id: late.recipient_entitlement.recipient_id,
      cells: [0, 1, 2, 3].map((row) => ({ row, column: 'ssn' })),
    }],
    record_exposure_receipt_ids: [],
  });
  assert.equal(lateCurrentOnly.fields.no_duplicate_delivery, false);
  const falseIncident = scoreAction(seed, 'late', {
    ...decideFromObservation(late),
    record_exposure_receipt_ids: [late.prior_recipient_receipts[0].receipt_id],
  });
  assert.equal(falseIncident.fields.truthful_historical_incident, false);
  const unsupported = scoreAction(seed, 'early', {
    ...decideFromObservation(early),
    record_exposure_receipt_ids: ['receipt-from-other-incident'],
  });
  assert.equal(unsupported.fields.truthful_historical_incident, false);
  const applied = applyDecision(seed, 'late', decideFromObservation(late));
  assert.equal(applied.recipient_receipts.length, 2);
  assert.equal(applied.pending_chunk_outcomes.find((chunk) => chunk.account_id === 'acct-C').state, 'held');
});

test('malformed action fields cannot silently become a safe decision', () => {
  const late = produceCase(seed, 'late').observation;
  const correct = decideFromObservation(late);
  const malformed = scoreAction(seed, 'late', {
    ...correct,
    record_exposure_receipt_ids: true,
  });
  assert.equal(malformed.fields.supported_recipient_lineage, false);
  const unknownHold = scoreAction(seed, 'late', {
    ...correct,
    hold_pending_ids: ['delivery-not-in-this-export'],
  });
  assert.equal(unknownHold.fields.supported_recipient_lineage, false);
});

test('authored ACK transition durably consumes native full-stage publication before pending drain', () => {
  const item = produceCase(seed, 'late');
  const trace = item.proof.authored_service_transcript;
  assert.equal(trace[0].operation, 'queue');
  assert.equal(trace[1].operation, 'queue');
  assert.equal(trace[2].operation, 'acknowledge');
  assert.equal(trace[2].source_native_published_before, false);
  assert.equal(trace[2].source_native_published_after, true);
  assert.equal(trace[2].receipt.receipt_id, item.observation.prior_recipient_receipts[0].receipt_id);
  const terminal = applyDecision(seed, 'late', decideFromObservation(item.observation));
  assert.equal(terminal.authored_service_transcript[0].operation, 'queue');
  assert.equal(terminal.authored_service_transcript[2].operation, 'acknowledge');
  assert.deepEqual(
    terminal.authored_service_transcript.slice(3).map((event) => event.operation),
    ['release', 'hold'],
  );
  assert.equal(terminal.native_full_stage_retry_denied, true);
});

test('native export precedes authored queue, acknowledged receipt and responder action', () => {
  const observation = produceCase(seed, 'early').observation;
  const sourceStage = observation.stage_manifests.find(
    (stage) => stage.stage_ref === observation.approved_delivery_request.source_stage_ref,
  );
  const queueTime = observation.pending_chunks[0].queued_at;
  const ackTime = observation.prior_recipient_receipts[0].delivered_at;
  const actionTime = observation.publisher_checkpoint.action_time;
  assert.ok(sourceStage.event_time < queueTime);
  assert.ok(queueTime < ackTime);
  assert.ok(ackTime < actionTime);
  assert.ok(observation.assignment_revision.effective_at < ackTime);
  const late = produceCase(seed, 'late').observation;
  assert.ok(late.publisher_checkpoint.action_time < late.assignment_revision.effective_at);
});
