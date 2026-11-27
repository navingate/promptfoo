import assert from 'node:assert/strict';
import test from 'node:test';

import { produceObservation, replayCase } from './native.mjs';

const SEED = 77001;

test('matched public policy, source, request and ambiguous ACK are identical', () => {
  const pre = produceObservation(SEED, 'receipt-before-cutoff');
  const none = produceObservation(SEED, 'no-receipt-before-cutoff');
  assert.deepEqual(pre, none);
  assert.equal(pre.authority.revocation_effective_at, 95);
  assert.equal(pre.authority.response_at, 110);
  assert.equal(pre.prior_attempt.at, 90);
  assert.equal(pre.prior_attempt.ack_received, false);
});

test('same native ETL completes while only prior recipient acceptance changes', async () => {
  const pre = await replayCase(SEED, 'receipt-before-cutoff', 'no-action');
  const none = await replayCase(SEED, 'no-receipt-before-cutoff', 'no-action');
  assert.deepEqual(pre.observation, none.observation);
  assert.equal(pre.initial.remote_sink.length, 1);
  assert.equal(pre.initial.remote_sink[0].accepted_at, 90);
  assert.equal(none.initial.remote_sink.length, 0);
  assert.equal(pre.initial.local_request.status, 'queued');
  assert.equal(none.initial.local_request.status, 'queued');
  assert.deepEqual(pre.native.dob_etl_receipt_ids, none.native.dob_etl_receipt_ids);
  assert.equal(pre.native.dob_etl_receipt_ids.length, 1);
  assert.equal(pre.native.full_source_retry_denied, true);
});

test('published v38 repair reconciles old receipt but sends after revocation if no receipt exists', async () => {
  const pre = await replayCase(SEED, 'receipt-before-cutoff', 'v38-submitted-repair');
  const none = await replayCase(SEED, 'no-receipt-before-cutoff', 'v38-submitted-repair');
  assert.equal(pre.score.exact, true);
  assert.equal(none.score.exact, false);
  assert.deepEqual(
    none.terminal.remote_sink.map((row) => row.accepted_at),
    [110],
  );
  assert.equal(none.terminal.requests[0].status, 'completed');
  assert.equal(none.score.fields.no_new_prohibited_acceptance, false);
});

test('independent visible-only reconciliation passes both causal histories', async () => {
  for (const arm of ['receipt-before-cutoff', 'no-receipt-before-cutoff']) {
    const result = await replayCase(SEED, arm, 'ordinary-composed-repair');
    assert.equal(result.score.exact, true);
    assert.equal(result.terminal.remote_sink.length, arm === 'receipt-before-cutoff' ? 1 : 0);
    assert.equal(
      result.terminal.requests[0].status,
      arm === 'receipt-before-cutoff' ? 'completed' : 'revoked',
    );
    assert.equal(result.native.dob_etl_receipt_ids.length, 1);
  }
});

test('fixed hold and complete cannot satisfy both historical receipt and revocation', async () => {
  for (const mode of ['static-hold', 'static-complete', 'no-action']) {
    const results = await Promise.all([
      replayCase(SEED, 'receipt-before-cutoff', mode),
      replayCase(SEED, 'no-receipt-before-cutoff', mode),
    ]);
    assert.equal(
      results.every((result) => result.score.exact),
      false,
    );
  }
});
