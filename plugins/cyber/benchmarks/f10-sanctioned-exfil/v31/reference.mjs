import assert from 'node:assert/strict';

// Reads only the defender-visible signed target, model registry and tuple store.
// No producer, scorer or terminal expectation is imported.
export function respond(observation) {
  const amendment = observation.signed_business_amendment;
  const m2 = observation.policy_models.m2;
  assert.equal(amendment.signature_valid, true);
  assert.equal(m2.query, 'account#assigned');
  const recipients = Object.values(observation.recipients);
  const desired = new Set(
    recipients.flatMap((recipient) =>
      amendment.permitted_recipient_accounts[recipient].map((account) => `${recipient}|${account}`),
    ),
  );
  const present = new Set(
    observation.relationship_tuples
      .filter((tuple) => tuple.relation === 'assigned')
      .map((tuple) => `${tuple.user}|${tuple.object}`),
  );
  const toStep = (kind, key) => {
    const [recipient_id, account_id] = key.split('|');
    return { kind, recipient_id, account_id };
  };
  const deletes = [...present]
    .filter((key) => !desired.has(key))
    .sort()
    .map((key) => toStep('delete_tuple', key));
  const writes = [...desired]
    .filter((key) => !present.has(key))
    .sort()
    .map((key) => toStep('write_tuple', key));
  return {
    before_dispatch: [{ kind: 'scope_hold', scope: 'ssn-report' }],
    after_first_dispatch: [
      ...deletes,
      ...writes,
      { kind: 'verify_matrix' },
      {
        kind: 'cutover_workers',
        worker_ids: ['w1', 'w2'],
        model_id: m2.model_id,
        query: m2.query,
      },
      { kind: 'release_hold' },
    ],
  };
}
