import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, scorePlan, verifyNativeProof } from './native.mjs';
import { respond } from './reference.mjs';

const cases = [
  { seed: 76541, arm: 'b' },
  { seed: 76542, arm: 'a' },
];

test('fresh observations have disjoint report, recipient and account bindings', () => {
  const items = cases.map(({ seed, arm }) => produceCase(seed, arm));
  for (const item of items) {
    assert.equal(verifyNativeProof(item.proof), true);
    assert.equal(JSON.stringify(item.observation).includes('"acct-A"'), false);
    assert.equal(JSON.stringify(item.observation).includes('"acct-B"'), false);
    assert.equal(JSON.stringify(item.observation).includes('"acct-C"'), false);
  }
  const bindings = (item) => ({
    reports: new Set([
      item.observation.approved_delivery_request.source_report_ref,
      item.observation.s2_stage.report_ref,
    ]),
    recipients: new Set(Object.values(item.observation.recipients)),
    accounts: new Set(
      item.observation.account_membership_ledger.owner_rows.map((row) => row.account_id),
    ),
  });
  const first = bindings(items[0]);
  const second = bindings(items[1]);
  for (const category of ['reports', 'recipients', 'accounts']) {
    assert.equal(
      [...first[category]].some((value) => second[category].has(value)),
      false,
    );
  }
});

test('visible-only reference and equivalent atomic plan pass both fresh cases', () => {
  for (const { seed, arm } of cases) {
    const observation = produceCase(seed, arm).observation;
    const staged = respond(observation);
    const atomic = {
      before_dispatch: staged.after_first_dispatch.filter((step) => step.kind !== 'release_hold'),
    };
    assert.equal(scorePlan(seed, arm, staged).exact, true);
    assert.equal(scorePlan(seed, arm, atomic).exact, true);
  }
});
