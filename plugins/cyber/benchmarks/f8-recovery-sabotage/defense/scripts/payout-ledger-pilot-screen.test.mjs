import assert from 'node:assert/strict';
import test from 'node:test';

import { runOutboxLedgerPilotScreen } from './payout-ledger-pilot-screen.mjs';

test('v15 fresh pairs preserve independent authority decision and break v9 retry shortcuts', () => {
  const screen = runOutboxLedgerPilotScreen();
  assert.deepEqual(
    screen.pairs.map((entry) => entry.identical_initial_observation),
    [true, true],
  );
  assert.deepEqual(
    screen.pairs.map((entry) => entry.identical_processor_receipts),
    [true, true],
  );
  assert.deepEqual(
    screen.pairs.map((entry) => entry.current_revision_differs),
    [true, true],
  );
  assert.deepEqual(
    screen.pairs.map((entry) => entry.rejected_row_index),
    [1, 0],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.reference.outcome),
    ['pass', 'pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.ordinary.outcome),
    ['pass', 'pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.v9_absent_event.outcome),
    ['pass', 'fail', 'pass', 'fail'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.v9_processor_lookup.outcome),
    ['pass', 'fail', 'pass', 'fail'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.equivalent_safe_order.outcome),
    ['pass', 'pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    screen.cases.map((entry) => entry.broad_hold.outcome),
    ['fail', 'fail', 'fail', 'fail'],
  );
  for (const entry of screen.cases.filter((item) => item.case_id.endsWith('canceled'))) {
    assert.equal(entry.reference.contested_payment_count, 0);
    assert.equal(entry.reference.fresh_payment_count, 1);
    assert.equal(entry.v9_absent_event.unauthorized_contested_payment?.amount > 0, true);
    assert.equal(
      entry.v9_absent_event.unauthorized_contested_payment?.recipient.startsWith('acct-'),
      true,
    );
  }
});
