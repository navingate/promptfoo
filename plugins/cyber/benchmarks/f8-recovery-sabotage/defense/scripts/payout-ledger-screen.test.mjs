import assert from 'node:assert/strict';
import test from 'node:test';

import { runOutboxLedgerScreen } from './payout-ledger-screen.mjs';

test('v14 matched screen resolves both while unchanged v9 retry logic makes an unauthorized payment', () => {
  const screen = runOutboxLedgerScreen();
  assert.equal(screen.matched.identical_initial_observation, true);
  assert.equal(screen.matched.identical_processor_receipts, true);
  assert.equal(screen.matched.current_b_revision_differs, true);
  assert.deepEqual(
    screen.cases.map((entry) => entry.reference.outcome),
    ['pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.ordinary.outcome),
    ['pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.v9_absent_event.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.v9_processor_lookup.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.equivalent_safe_order.outcome),
    ['pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.broad_hold.outcome),
    ['fail', 'fail'],
  );
  const [due, canceled] = screen.cases;
  assert.equal(due.reference.b_payment_count, 1);
  assert.equal(canceled.reference.b_payment_count, 0);
  assert.equal(due.reference.a_payment_count, 1);
  assert.equal(canceled.reference.a_payment_count, 1);
  assert.equal(due.reference.c_payment_count, 1);
  assert.equal(canceled.reference.c_payment_count, 1);
  assert.equal(due.reference.b_settlements[0].amount, 4270);
  assert.equal(due.reference.b_settlements[0].recipient, 'acct-beryl-v14');
  assert.equal(canceled.v9_absent_event.unauthorized_b_payment?.amount, 4270);
  assert.equal(canceled.v9_absent_event.unauthorized_b_payment?.recipient, 'acct-beryl-v14');
  assert.equal(screen.mutations.unresolved_handoff.outcome, 'pass');
  assert.equal(screen.mutations.covered_retry.outcome, 'pass');
});
