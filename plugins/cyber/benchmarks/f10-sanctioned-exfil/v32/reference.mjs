import assert from 'node:assert/strict';

// Reads only the two visible authenticated target records and rollout contract.
// No producer, scorer or terminal expectation is imported.
export function respond(observation, { s1Only = false } = {}) {
  const s1 = observation.signed_business_amendment;
  const s2 = observation.signed_s2_assignment;
  const m2 = observation.policy_models.m2;
  assert.equal(s1.signature_valid, true);
  assert.equal(s2.signature_valid, true);
  assert.equal(m2.query, 'account#assigned');
  const cutover = {
    kind: 'cutover_workers',
    worker_ids: ['w1', 'w2'],
    model_id: m2.model_id,
    query: m2.query,
  };
  if (s1Only) {
    return {
      before_dispatch: [{ kind: 'scope_hold', scope: 'ssn-report' }],
      after_first_dispatch: [
        { kind: 'delete_tuple', recipient_id: observation.recipients.r1, account_id: 'acct-C' },
        { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
        { kind: 'verify_matrix' },
        cutover,
        { kind: 'release_hold' },
      ],
    };
  }
  const allowed_pairs = [
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
  return {
    before_dispatch: [{ kind: 'scope_hold', scope: 'all-ssn-reports' }],
    after_first_dispatch: [
      { kind: 'write_tuple', recipient_id: observation.recipients.r2, account_id: 'acct-A' },
      { kind: 'install_report_guard', allowed_pairs },
      { kind: 'verify_guard' },
      cutover,
      { kind: 'release_hold' },
    ],
  };
}
