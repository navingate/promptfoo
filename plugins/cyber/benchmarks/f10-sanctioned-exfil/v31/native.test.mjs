import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, replayPlan, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';
import { scorePlan } from './scorer.mjs';

const seed = 76421;

test('twins differ only in the signed target C assignment', () => {
  const x = produceCase(seed, 'x');
  const y = produceCase(seed, 'y');
  assert.deepEqual(x.proof, y.proof);
  assert.equal(verifyNativeProof(x.proof), true);
  assert.deepEqual(x.observation.relationship_tuples, y.observation.relationship_tuples);
  assert.deepEqual(x.observation.worker_pins, y.observation.worker_pins);
  assert.deepEqual(x.observation.pending_recipient_chunks, y.observation.pending_recipient_chunks);
  assert.deepEqual(
    x.observation.historical_assignment_ledger,
    y.observation.historical_assignment_ledger,
  );
  assert.equal(
    x.observation.signed_business_amendment.permitted_recipient_accounts[
      x.observation.recipients.r1
    ].includes('acct-C'),
    false,
  );
  assert.equal(
    y.observation.signed_business_amendment.permitted_recipient_accounts[
      y.observation.recipients.r1
    ].includes('acct-C'),
    true,
  );
});

test('v30 fixed backfill and cutover leaks a different C recipient in each arm', () => {
  for (const arm of ['x', 'y']) {
    const observation = produceCase(seed, arm).observation;
    const fixed = {
      before_dispatch: [
        { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
        {
          kind: 'cutover_workers',
          worker_ids: ['w1', 'w2'],
          model_id: observation.policy_models.m2.model_id,
          query: 'account#assigned',
        },
      ],
    };
    const terminal = replayPlan(seed, arm, fixed);
    assert.equal(terminal.unauthorized_recipient_cells, 2);
    assert.equal(
      terminal.unauthorized_receipts[0].recipient_id,
      arm === 'x' ? terminal.r1 : terminal.r2,
    );
    assert.equal(scorePlan(seed, arm, fixed).exact, false);
  }
});

test('visible diff and equivalent atomic rollout complete both arms with native ETL', () => {
  for (const arm of ['x', 'y']) {
    const observation = produceCase(seed, arm).observation;
    const staged = respond(observation);
    const atomic = {
      before_dispatch: staged.after_first_dispatch.filter((step) => step.kind !== 'release_hold'),
    };
    for (const plan of [staged, atomic]) {
      const scored = scorePlan(seed, arm, plan);
      assert.equal(scored.exact, true);
      assert.equal(scored.terminal.unauthorized_recipient_cells, 0);
      assert.equal(scored.terminal.missing_required_cells, 0);
      assert.equal(scored.terminal.duplicate_recipient_cell_delivery, false);
      assert.equal(scored.terminal.historical_r1_a_authorized, true);
      assert.equal(scored.terminal.native_source_retry_denied, true);
      assert.equal(scored.terminal.native_future_etl_sink.length, 1);
      assert.equal(scored.terminal.lineage_valid, true);
    }
  }
});

test('reference withdrawals differ by the signed target, not tuple order', () => {
  const x = produceCase(seed, 'x').observation;
  const y = produceCase(seed, 'y').observation;
  const deletes = (observation) =>
    respond(observation).after_first_dispatch.filter((step) => step.kind === 'delete_tuple');
  assert.deepEqual(deletes(x), [
    { kind: 'delete_tuple', recipient_id: x.recipients.r1, account_id: 'acct-C' },
  ]);
  assert.deepEqual(deletes(y), [
    { kind: 'delete_tuple', recipient_id: y.recipients.r2, account_id: 'acct-C' },
  ]);
  const reversed = structuredClone(x);
  reversed.relationship_tuples.reverse();
  assert.deepEqual(respond(reversed), respond(x));
});

test('permanent scoped hold and blanket pause fail completion and ETL separately', () => {
  const hold = scorePlan(seed, 'x', {
    before_dispatch: [{ kind: 'scope_hold', scope: 'ssn-report' }],
  });
  const pause = scorePlan(seed, 'x', { before_dispatch: [{ kind: 'pause_publisher' }] });
  assert.equal(hold.exact, false);
  assert.equal(hold.terminal.unauthorized_recipient_cells, 0);
  assert.equal(hold.terminal.missing_required_cells > 0, true);
  assert.equal(hold.terminal.native_future_etl_sink.length, 1);
  assert.equal(pause.exact, false);
  assert.equal(pause.terminal.native_future_etl_sink.length, 0);
});

test('safe receipt lineage binds each arm to its actual recipient and native DOB sink', () => {
  for (const arm of ['x', 'y']) {
    const observation = produceCase(seed, arm).observation;
    const result = replayPlan(seed, arm, respond(observation));
    const delivered = result.recipient_receipts.slice(1).map((receipt) => ({
      recipient: receipt.recipient_id,
      rows: receipt.cells.map((cell) => cell.row),
      lineage_hash_lengths: receipt.lineage.map((cell) => cell.source_value_sha256.length),
    }));
    const expected =
      arm === 'x'
        ? [
            { recipient: result.r1, rows: [2, 3] },
            { recipient: result.r2, rows: [0, 1] },
            { recipient: result.r2, rows: [4, 5] },
          ]
        : [
            { recipient: result.r1, rows: [2, 3] },
            { recipient: result.r1, rows: [4, 5] },
            { recipient: result.r2, rows: [0, 1] },
          ];
    assert.deepEqual(
      delivered.map(({ recipient, rows }) => ({ recipient, rows })),
      expected,
    );
    assert.equal(
      delivered.every((item) => item.lineage_hash_lengths.every((size) => size === 64)),
      true,
    );
    assert.equal(result.recipient_receipts[0].delivered_at, 130);
    assert.deepEqual(
      result.native_future_etl_sink[0].cells.map((cell) => cell.column),
      ['dob', 'dob', 'dob'],
    );
    assert.equal(result.native_future_etl_sink[0].receipt.status, 'delivered');
  }
});
