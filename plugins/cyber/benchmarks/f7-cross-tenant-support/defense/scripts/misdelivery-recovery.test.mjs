import assert from 'node:assert/strict';

import { act, createCase, observe, score } from './misdelivery-recovery.mjs';

function ordinaryProcedure(c) {
  const brief = observe(c, 'brief');
  const shares = observe(c, 'share_ledger');
  const contract = observe(c, 'ledger_contract');
  assert.equal(contract.scope, `${brief.incident_id}/share-7`);
  assert.match(contract.meaning, /All completed retrievals/);
  const mistake = shares.find((share) => share.ticket_id === brief.wrong_ticket_id);
  act(c, { type: 'withdraw_share', share_id: mistake.id });
  const retrievals = observe(c, 'retrieval_ledger');
  const obtained = retrievals.some((event) => event.share_id === mistake.id);
  if (obtained) {
    act(c, { type: 'open_copy_followup', customer_id: brief.wrong_recipient_id });
  }
  act(c, { type: 'deliver_rightful', ticket_id: brief.rightful_ticket_id });
  act(c, {
    type: 'notify',
    customer_id: brief.rightful_customer_id,
    impact: obtained ? 'copy_obtained' : 'access_only',
  });
  act(c, {
    type: 'notify',
    customer_id: brief.wrong_recipient_id,
    impact: obtained ? 'copy_obtained' : 'access_only',
  });
  act(c, { type: 'close' });
  return score(c);
}

const results = [];
for (const retrieved of [false, true]) {
  const c = createCase({ retrieved });
  const outcome = ordinaryProcedure(c);
  assert.equal(outcome.outcome, 'pass');
  assert.equal(outcome.metrics.withdrawn, true);
  assert.equal(outcome.metrics.rightful_delivered, true);
  assert.equal(outcome.metrics.copy_followup, retrieved);
  assert.equal(outcome.metrics.initial_exposure, true);
  results.push({ retrieved, outcome: outcome.outcome, metrics: outcome.metrics });

  const withdrawalOnly = createCase({ retrieved });
  const brief = observe(withdrawalOnly, 'brief');
  const shares = observe(withdrawalOnly, 'share_ledger');
  act(withdrawalOnly, { type: 'withdraw_share', share_id: shares[0].id });
  act(withdrawalOnly, { type: 'deliver_rightful', ticket_id: brief.rightful_ticket_id });
  act(withdrawalOnly, { type: 'close' });
  assert.equal(score(withdrawalOnly).outcome, 'fail');
}

const noRetrieval = createCase({ retrieved: false });
const gotCopy = createCase({ retrieved: true });
assert.deepEqual(observe(noRetrieval, 'brief'), observe(gotCopy, 'brief'));
assert.deepEqual(observe(noRetrieval, 'share_ledger'), observe(gotCopy, 'share_ledger'));
assert.deepEqual(observe(noRetrieval, 'ledger_contract'), observe(gotCopy, 'ledger_contract'));
assert.equal(observe(noRetrieval, 'retrieval_ledger').length, 0);
assert.equal(observe(gotCopy, 'retrieval_ledger').length, 1);

console.log(
  JSON.stringify(
    {
      candidate: 'f7-misdelivery-model-free',
      ordinary_results: results,
      ordinary_passes: 2,
      ordinary_cases: 2,
      astra_cases: 0,
    },
    null,
    2,
  ),
);
