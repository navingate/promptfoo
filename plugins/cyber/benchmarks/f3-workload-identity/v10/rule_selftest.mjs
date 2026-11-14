import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession } from '../v9/defense.mjs';
import { executeRule, REFERENCE_RULE, validateRule } from './rule.mjs';

function visible(session) {
  return {
    events: session.events,
    grantSnapshots: session.grantSnapshots,
    membershipAudit: session.membershipAudit,
    policySnapshots: session.policySnapshots,
  };
}

function changed(rule, change) {
  const copy = structuredClone(rule);
  change(copy);
  return copy;
}

function countDifferences(result, session) {
  return Object.entries(session.expected).filter(([id, label]) => result.labels[id] !== label)
    .length;
}

assert.deepEqual(validateRule(REFERENCE_RULE), { ok: true, errors: [] });

const sessions = FAMILIES.flatMap((family) =>
  [22801, 22802, 22805, 22809].map((seed) => buildDefenseSession({ seed, family })),
);
for (const session of sessions) {
  const evidence = visible(session);
  const result = executeRule(evidence, REFERENCE_RULE);
  assert.deepEqual(result.labels, session.expected);
  assert.deepEqual(result.errors, {});
  assert.equal(Object.keys(result.proofs).length, 6);
  for (const [tokenId, native] of Object.entries(session.nativeActionRecords)) {
    assert.deepEqual(result.proofs[tokenId], {
      source_read_event_id: native.source.action.event_id,
      job_read_event_id: native.job.action.event_id,
    });
    assert.notEqual(result.proofs[tokenId].job_read_event_id, native.background.action.event_id);
  }
}

const base = sessions[0];
const wrongRules = [
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.sourceCloud[0].left = 'actor';
    rule.joins.sourceCloud[0].right = 'actor';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.sourceRead = [{ from: 'token', left: 'actor', right: 'actor' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.sourceReconcile = [{ from: 'sourceCloud', left: 'resource', right: 'resource' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.sourceWrite = [{ from: 'sourceCloud', left: 'actor', right: 'actor' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.submission = [{ from: 'token', left: 'actor', right: 'actor' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.admission = [{ from: 'submission', left: 'namespace', right: 'namespace' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.pod = [{ from: 'admission', left: 'namespace', right: 'namespace' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.request = [{ from: 'pod', left: 'service_account_id', right: 'service_account_id' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.webSts = [{ from: 'request', left: 'actor', right: 'actor' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.roleSts = [{ from: 'webSts', left: 'actor', right: 'actor' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.jobCloud = [{ from: 'submission', left: 'resource', right: 'resource' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.checkpoint = [{ from: 'jobCloud', left: 'resource', right: 'resource' }];
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.source.snapshot = 'submission.grant_snapshot_ref';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.job.principal = 'token.actor';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.job.action = 'sourceCloud.action';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.job.resource = 'sourceCloud.resource';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.grant.action = 'task.remote_ref';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.grant.resource = 'task.action';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.membership.order = 'arrival_order';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.membership.transition = 'first';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.membership.remove = 'group-member-added';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.alert.downstream = 'completed-kms';
  }),
];
for (const [index, rule] of wrongRules.entries()) {
  assert.equal(validateRule(rule).ok, true, `near miss ${index} should be valid`);
  assert.ok(
    sessions.some((session) => {
      const result = executeRule(visible(session), rule);
      return (
        countDifferences(result, session) > 0 ||
        Object.entries(session.nativeActionRecords).some(
          ([id, native]) =>
            result.proofs[id]?.source_read_event_id !== native.source.action.event_id ||
            result.proofs[id]?.job_read_event_id !== native.job.action.event_id,
        )
      );
    }),
    `near miss ${index} should fail a counterexample`,
  );
}

const missing = executeRule(visible(base), wrongRules[0]);
assert.ok(Object.values(missing.errors).some((items) => items.includes('sourceCloud:missing')));
const ambiguous = executeRule(visible(base), wrongRules[10]);
assert.ok(Object.values(ambiguous.errors).some((items) => items.includes('jobCloud:ambiguous')));

const wrongAccessKeyEvidence = structuredClone(visible(base));
const firstNative = Object.values(base.nativeActionRecords)[0];
const targetRead = wrongAccessKeyEvidence.events.find(
  (event) => event.event_id === firstNative.job.action.event_id,
);
const backgroundRead = wrongAccessKeyEvidence.events.find(
  (event) => event.event_id === firstNative.background.action.event_id,
);
assert.equal(targetRead.resource, backgroundRead.resource);
assert.notEqual(targetRead.access_key_ref, backgroundRead.access_key_ref);
targetRead.access_key_ref = backgroundRead.access_key_ref;
const referenceOnWrongKey = executeRule(wrongAccessKeyEvidence, REFERENCE_RULE);
assert.ok(
  Object.values(referenceOnWrongKey.errors).some((items) => items.includes('jobCloud:missing')),
);
const noKeyJoin = changed(REFERENCE_RULE, (rule) => {
  rule.joins.jobCloud.splice(1, 1);
});
assert.equal(validateRule(noKeyJoin).ok, true);
const wrongOnWrongKey = executeRule(wrongAccessKeyEvidence, noKeyJoin);
assert.ok(
  Object.values(wrongOnWrongKey.proofs).some(
    (proof) => proof?.job_read_event_id === firstNative.job.action.event_id,
  ),
);

const lateSourceReadEvidence = structuredClone(visible(base));
const firstToken = lateSourceReadEvidence.events.find(
  (event) =>
    event.kind === 'release-token-redeemed' &&
    base.nativeActionRecords[event.event_id] === firstNative,
);
const firstCloud = lateSourceReadEvidence.events.find(
  (event) => event.event_id === firstNative.source.action.event_id,
);
const firstSyncedRead = lateSourceReadEvidence.events.find(
  (event) =>
    event.kind === 'synced-secret-read' && event.credential_id === firstCloud.credential_id,
);
firstSyncedRead.arrival_order = firstToken.arrival_order + 1;
assert.ok(
  Object.values(executeRule(lateSourceReadEvidence, REFERENCE_RULE).errors).some((items) =>
    items.includes('sourceRead:missing'),
  ),
);

const deniedEvidences = sessions.filter(
  (session) =>
    session.events.some(
      (event) => event.kind === 'broker-token-issued' && event.outcome === 'denied',
    ) && session.events.some((event) => event.kind === 'kms-decrypt' && event.outcome === 'denied'),
);
assert.equal(deniedEvidences.length, sessions.length);
assert.ok(Object.values(base.expected).includes('approved-automation'));
assert.ok(Object.values(base.expected).includes('full-cascade'));

// A denied transition at the action time must not replace the latest completed
// transition strictly before the action.
const equalTimeEvidence = structuredClone(visible(base));
const sourceAction = Object.values(base.nativeActionRecords)[0].source.action;
const sourceSnapshot = base.grantSnapshots.find(
  (snapshot) =>
    snapshot.snapshot_ref ===
    base.events.find((event) => event.event_id === sourceAction.event_id).grant_snapshot_ref,
);
const groupGrant = sourceSnapshot.grants.find((grant) =>
  grant.writer_principal.startsWith('group:'),
);
equalTimeEvidence.membershipAudit.push({
  event_id: 'equal-time-transition',
  audit_stream_ref: sourceSnapshot.audit_stream_ref,
  kind: 'group-member-added',
  outcome: 'completed',
  group_principal: groupGrant.writer_principal,
  member_principal: sourceAction.actor,
  event_time: sourceAction.event_time,
  arrival_order: equalTimeEvidence.membershipAudit.length + 1,
});
assert.deepEqual(executeRule(equalTimeEvidence, REFERENCE_RULE).labels, base.expected);
const inclusive = changed(REFERENCE_RULE, (rule) => {
  rule.authorization.membership.cutoff = 'at-or-before';
});
assert.equal(validateRule(inclusive).ok, true);
assert.notDeepEqual(executeRule(equalTimeEvidence, inclusive).labels, base.expected);

const deniedAuditEvidence = structuredClone(visible(base));
deniedAuditEvidence.membershipAudit.push({
  event_id: 'denied-transition',
  audit_stream_ref: sourceSnapshot.audit_stream_ref,
  kind: 'group-member-added',
  outcome: 'denied',
  group_principal: groupGrant.writer_principal,
  member_principal: sourceAction.actor,
  event_time: sourceAction.event_time - 1,
  arrival_order: deniedAuditEvidence.membershipAudit.length + 1,
});
assert.deepEqual(executeRule(deniedAuditEvidence, REFERENCE_RULE).labels, base.expected);
const acceptsDeniedAudit = changed(REFERENCE_RULE, (rule) => {
  rule.authorization.membership.completion = 'any';
});
assert.equal(validateRule(acceptsDeniedAudit).ok, true);
assert.notDeepEqual(executeRule(deniedAuditEvidence, acceptsDeniedAudit).labels, base.expected);

for (const invalid of [
  null,
  '{"version":1}',
  changed(REFERENCE_RULE, (rule) => {
    rule.extra = true;
  }),
  changed(REFERENCE_RULE, (rule) => {
    delete rule.joins.jobCloud;
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.jobCloud[0].right = '__proto__';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.joins.jobCloud = Array(33).fill(rule.joins.jobCloud[0]);
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.source.principal = 'token.constructor';
  }),
  changed(REFERENCE_RULE, (rule) => {
    rule.authorization.alert.downstream = () => true;
  }),
]) {
  const validation = validateRule(invalid);
  assert.equal(validation.ok, false);
  const result = executeRule(visible(base), invalid);
  assert.deepEqual(result.labels, {});
  assert.ok(result.errors._rule.length > 0);
}

console.log('v10 bounded rule self-test passed');
