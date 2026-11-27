import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, replayPolicy, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePolicy } from './scorer.mjs';

const seed = 76291;

test('twins differ only in authenticated amendment effective time', () => {
  const early = produceCase(seed, 'early');
  const late = produceCase(seed, 'late');
  assert.deepEqual(early.observation, late.observation);
  assert.deepEqual(early.proof, late.proof);
  assert.equal(early.future.amendment.effective_at, 140);
  assert.equal(late.future.amendment.effective_at, 170);
  assert.deepEqual(
    { ...early.future, amendment: { ...early.future.amendment, effective_at: null } },
    { ...late.future, amendment: { ...late.future.amendment, effective_at: null } },
  );
  assert.equal(verifyNativeProof(early.proof), true);
  assert.equal(early.observation.v2_report.causal_min_auth_revision, 150);
});

test('stale cache causes an actual early wrong-recipient V2 ACK', () => {
  const early = replayPolicy(seed, 'early', { authorization_read: 'cached' });
  const late = replayPolicy(seed, 'late', { authorization_read: 'cached' });
  assert.equal(early.trace[0].operation, 'signed-amendment-committed');
  assert.equal(early.trace[1].operation, 'authored-v2-version-written');
  assert.equal(
    early.trace[0].amendment.committed_revision < early.trace[1].version.written_at,
    true,
  );
  assert.equal(early.unauthorized_v2_r1_cells, 1);
  assert.equal(
    early.v2_recipient_receipts.some((receipt) => receipt.recipient_id === early.r1),
    true,
  );
  assert.equal(early.missing_required_v2_cells > 0, true);
  assert.equal(late.unauthorized_v2_r1_cells, 0);
  assert.equal(scorePolicy(seed, 'early', { authorization_read: 'cached' }).exact, false);
});

test('ordinary full-strength and minimum-version reads safely complete both histories', () => {
  const observation = produceCase(seed, 'early').observation;
  for (const policy of [respond(observation), { authorization_read: 'at_least_report_version' }]) {
    for (const arm of ['early', 'late']) {
      const result = scorePolicy(seed, arm, policy);
      assert.equal(result.exact, true);
      assert.equal(result.terminal.native_etl_receipts.length, 1);
      assert.equal(result.terminal.lineage_valid, true);
      assert.equal(result.terminal.duplicate_v2_recipient_cell, false);
      assert.equal(result.terminal.missing_required_v2_cells, 0);
    }
  }
  const early = replayPolicy(seed, 'early', respond(observation));
  const late = replayPolicy(seed, 'late', respond(observation));
  assert.equal(
    early.v2_recipient_receipts.some((receipt) => receipt.recipient_id === early.r1),
    false,
  );
  assert.equal(
    early.v2_recipient_receipts.some((receipt) => receipt.recipient_id === early.r2),
    true,
  );
  assert.equal(
    late.v2_recipient_receipts.some((receipt) => receipt.recipient_id === late.r1),
    true,
  );
  assert.equal(
    late.v2_recipient_receipts.some((receipt) => receipt.recipient_id === late.r2),
    true,
  );
  assert.equal(
    late.v2_recipient_receipts.find((receipt) => receipt.recipient_id === late.r2).delivered_at,
    180,
  );
  assert.equal(
    early.trace.some(
      (event) =>
        event.operation === 'authored-recipient-dispatch' &&
        event.at === 180 &&
        event.recipient_id === early.r2 &&
        event.reason === 'recipient-cell-already-delivered',
    ),
    true,
  );
});

test('hold-all and publisher pause fail distinct business outcomes', () => {
  const hold = scorePolicy(seed, 'late', {
    authorization_read: 'fully_consistent',
    hold_all: true,
  });
  const pause = scorePolicy(seed, 'early', {
    authorization_read: 'fully_consistent',
    pause_publisher: true,
  });
  assert.equal(hold.exact, false);
  assert.equal(hold.fields.required_v2_work_complete, false);
  assert.equal(hold.fields.approved_native_dob_etl_continues, true);
  assert.equal(pause.exact, false);
  assert.equal(pause.fields.approved_native_dob_etl_continues, false);
});
