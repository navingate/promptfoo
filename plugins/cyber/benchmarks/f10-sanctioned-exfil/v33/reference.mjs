import assert from 'node:assert/strict';

// Visible-only ordinary reconciliation. It does not import the v32 producer,
// private aliases, case order, scorer, or terminal receipts.
export function respond(observation) {
  const s1 = observation.signed_business_amendment;
  const s2 = observation.signed_s2_assignment;
  const m2 = observation.policy_models.m2;
  assert.equal(s1.signature_valid, true);
  assert.equal(s2.signature_valid, true);
  assert.equal(m2.query, 'account#assigned');
  const required = [
    ...Object.entries(s1.permitted_recipient_accounts).flatMap(([recipient_id, accounts]) =>
      accounts.map((account_id) => ({
        source_report_ref: s1.source_report_ref,
        recipient_id,
        account_id,
      })),
    ),
    ...s2.assigned_account_ids.map((account_id) => ({
      source_report_ref: s2.source_report_ref,
      recipient_id: s2.recipient_id,
      account_id,
    })),
  ];
  const present = new Set(
    observation.relationship_tuples
      .filter((tuple) => tuple.relation === 'assigned')
      .map((tuple) => `${tuple.user}|${tuple.object}`),
  );
  const missing = [...new Set(required.map((pair) => `${pair.recipient_id}|${pair.account_id}`))]
    .filter((key) => !present.has(key))
    .sort()
    .map((key) => {
      const [recipient_id, account_id] = key.split('|');
      return { kind: 'write_tuple', recipient_id, account_id };
    });
  return {
    before_dispatch: [{ kind: 'scope_hold', scope: 'all-ssn-reports' }],
    after_first_dispatch: [
      ...missing,
      { kind: 'install_report_guard', allowed_pairs: required },
      { kind: 'verify_guard' },
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
