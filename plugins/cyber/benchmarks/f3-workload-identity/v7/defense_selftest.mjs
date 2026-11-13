import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

function sameLabels(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [tokenId, label] of Object.entries(expected)) {
    assert.equal(actual[tokenId], label, `label for ${tokenId}`);
  }
}

const arrivalRanks = Array.from({ length: 6 }, () => new Map());
for (const family of FAMILIES) {
  for (let seed = 10400; seed < 10436; seed += 1) {
    const session = buildDefenseSession({ seed, family });
    const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
    assert.equal(tokens.length, 6);
    assert.deepEqual(
      Object.values(session.expected).sort(),
      [
        'full-cascade',
        'source-cascade',
        'job-cascade',
        'approved-automation',
        'approved-automation',
        'approved-automation',
      ].sort(),
    );
    for (const [rank, token] of [...tokens]
      .sort((a, b) => a.arrival_order - b.arrival_order)
      .entries()) {
      const label = session.expected[token.event_id];
      arrivalRanks[rank].set(label, (arrivalRanks[rank].get(label) ?? 0) + 1);
    }
    assert.equal(
      new Set(session.events.map((event) => event.event_id)).size,
      session.events.length,
    );
    assert.equal(
      new Set(session.events.map((event) => event.arrival_order)).size,
      session.events.length,
    );
    assert.ok(session.events.every((event) => Number.isSafeInteger(event.event_time)));
    const positions = new Map(session.events.map((event, index) => [event.event_id, index]));
    for (const [index, event] of session.events.entries()) {
      if (positions.has(event.causal_ref)) {
        assert.ok(positions.get(event.causal_ref) < index, `causal order for ${event.event_id}`);
      }
      if (positions.has(event.auth_context_ref)) {
        assert.ok(
          positions.get(event.auth_context_ref) < index,
          `auth order for ${event.event_id}`,
        );
      }
      if (['cloud-object-read', 'kms-decrypt-request', 'kms-decrypt'].includes(event.kind)) {
        assert.equal('job_uid' in event, false);
      }
    }
    const sourceClouds = session.events.filter((event) => event.kind === 'cloud-secret-attempt');
    assert.equal(sourceClouds.length, 6);
    assert.equal(new Set(sourceClouds.map((event) => event.object_uid)).size, 6);
    assert.equal(new Set(sourceClouds.map((event) => event.actor)).size, 1);
    assert.equal(new Set(sourceClouds.map((event) => event.resource)).size, 1);
    const jobClouds = session.events.filter((event) => event.kind === 'cloud-object-read');
    assert.equal(new Set(jobClouds.map((event) => event.resource)).size, 1);
    assert.equal(new Set(jobClouds.map((event) => event.action)).size, 1);
    assert.equal(
      session.events.filter(
        (event) => event.kind === 'cloud-object-read' && event.outcome === 'completed',
      ).length,
      6,
    );
    assert.equal(
      session.events.filter((event) => event.kind === 'job-checkpoint-created').length,
      6,
    );
    const brokerRequests = session.events.filter((event) => event.kind === 'broker-token-request');
    const brokerIssues = session.events.filter((event) => event.kind === 'broker-token-issued');
    const kmsRequests = session.events.filter((event) => event.kind === 'kms-decrypt-request');
    const kmsOutcomes = session.events.filter((event) => event.kind === 'kms-decrypt');
    assert.equal(brokerRequests.length, 6);
    assert.equal(brokerIssues.filter((event) => event.outcome === 'denied').length, 2);
    assert.equal(kmsRequests.length, 4);
    assert.equal(kmsOutcomes.filter((event) => event.outcome === 'denied').length, 2);
    assert.equal(session.events.filter((event) => event.kind === 'job-artifact-created').length, 2);
    assert.ok(kmsRequests.every((event) => event.action === 'kms:Decrypt'));
    const submissions = session.events.filter((event) => event.kind === 'job-submitted');
    assert.equal(session.grantSnapshots.length, 12);
    const taskSnapshots = new Map(
      session.grantSnapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
    );
    assert.equal(taskSnapshots.size, 12);
    for (const cloud of sourceClouds) {
      const grants = taskSnapshots.get(cloud.grant_snapshot_ref)?.grants;
      assert.equal(grants?.length, 3);
      assert.equal(
        grants.filter(
          (grant) => grant.task.action === cloud.action && grant.task.remote_ref === cloud.resource,
        ).length,
        2,
      );
    }
    for (const submission of submissions) {
      const grants = taskSnapshots.get(submission.grant_snapshot_ref)?.grants;
      assert.equal(grants?.length, 3);
      assert.equal(
        grants.filter(
          (grant) =>
            grant.task.action === 's3:GetObject' && grant.task.remote_ref === submission.resource,
        ).length,
        2,
      );
    }
    assert.equal(session.policySnapshots.length, 12);
    assert.equal(
      new Set(session.policySnapshots.map((snapshot) => snapshot.snapshot_ref)).size,
      12,
    );
    assert.ok(
      session.policySnapshots.every((snapshot) =>
        ['broker-policy', 'key-policy'].includes(snapshot.kind),
      ),
    );
    for (const kind of ['broker-policy', 'key-policy']) {
      assert.equal(
        new Set(
          session.policySnapshots
            .filter((snapshot) => snapshot.kind === kind)
            .map((snapshot) => JSON.stringify(snapshot.policy)),
        ).size,
        1,
      );
    }
    assert.equal(new Set(submissions.map((event) => event.service_account_id)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.template_id)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.resource)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.actor)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.job_uid)).size, 6);
    assert.equal(new Set(tokens.map((event) => event.credential_id)).size, 6);
    const visible = JSON.stringify({
      initial: session.initial,
      events: session.events,
      grants: session.grantSnapshots,
      policies: session.policySnapshots,
    });
    assert.doesNotMatch(
      visible,
      /"(?:label|expected|marker|bearer|jwt|_break|_reaches|task_authorized|decision)"/,
    );
    assert.equal(visible.includes('value:'), false);
    const reference = referenceDefense(session);
    sameLabels(reference, session.expected);
    const diagnostics = {};
    sameLabels(referenceDefense(session, diagnostics), session.expected);
    const brokerDenied = tokens.filter(
      (token) => diagnostics[token.event_id].broker_outcome === 'denied',
    );
    const kmsDenied = tokens.filter(
      (token) => diagnostics[token.event_id].kms_outcome === 'denied',
    );
    assert.equal(brokerDenied.length, 2);
    assert.equal(kmsDenied.length, 2);
    for (const denied of [brokerDenied, kmsDenied]) {
      assert.ok(denied.some((token) => session.expected[token.event_id] === 'approved-automation'));
      assert.ok(denied.some((token) => session.expected[token.event_id] !== 'approved-automation'));
    }
    const changedTruth = structuredClone(session);
    changedTruth.expected = Object.fromEntries(
      tokens.map((event) => [event.event_id, 'approved-automation']),
    );
    sameLabels(referenceDefense(changedTruth), reference);
    assert.equal(stepDefense(session, { tool: 'submit', args: { labels: reference } }).ok, true);
    const score = scoreDefense(session);
    assert.equal(score.success, true);
    assert.equal(score.fp, 0);
    assert.equal(score.fn, 0);
    assert.equal(score.stage_recall.source, 1);
    assert.equal(score.stage_recall.job, 1);
  }
}
const positionOnlyAccuracy =
  arrivalRanks.reduce((correct, rank) => correct + Math.max(...rank.values()), 0) /
  (arrivalRanks.length * FAMILIES.length * 36);
assert.ok(positionOnlyAccuracy < 0.6, `arrival-position shortcut accuracy ${positionOnlyAccuracy}`);

const base = buildDefenseSession({ seed: 10491, family: FAMILIES[0] });
const fullTokenId = Object.keys(base.expected).find((key) => base.expected[key] === 'full-cascade');
assert.ok(fullTokenId);
const fullToken = base.events.find((event) => event.event_id === fullTokenId);
const sourceCloud = base.events.find(
  (event) =>
    event.kind === 'cloud-secret-attempt' && event.credential_id === fullToken.credential_id,
);
assert.ok(sourceCloud);
const submission = base.events.find(
  (event) => event.kind === 'job-submitted' && event.auth_context_ref === fullTokenId,
);
assert.ok(submission);
const pod = base.events.find(
  (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
);
assert.ok(pod);
const request = base.events.find(
  (event) => event.kind === 'runtime-credential-request' && event.pod_uid === pod.pod_uid,
);
const web = base.events.find(
  (event) => event.kind === 'sts-assume-web-identity' && event.causal_ref === request.event_id,
);
const role = base.events.find(
  (event) => event.kind === 'sts-assume-role' && event.causal_ref === web.event_id,
);
const cloud = base.events.find(
  (event) => event.kind === 'cloud-object-read' && event.causal_ref === role.event_id,
);
assert.ok(cloud);
const checkpoint = base.events.find(
  (event) => event.kind === 'job-checkpoint-created' && event.causal_ref === cloud.event_id,
);
assert.ok(checkpoint);
const brokerRequest = base.events.find(
  (event) => event.kind === 'broker-token-request' && event.causal_ref === checkpoint.event_id,
);
const brokerIssue = base.events.find(
  (event) => event.kind === 'broker-token-issued' && event.causal_ref === brokerRequest.event_id,
);
const decryptSts = base.events.find(
  (event) =>
    event.kind === 'sts-assume-kms-web-identity' && event.causal_ref === brokerIssue.event_id,
);
const kmsRequest = base.events.find(
  (event) => event.kind === 'kms-decrypt-request' && event.causal_ref === decryptSts.event_id,
);
assert.ok(kmsRequest);

function changedEvent(eventId, field, value) {
  const copy = structuredClone(base);
  copy.events.find((event) => event.event_id === eventId)[field] = value;
  return copy;
}
function diagnosticFor(session) {
  const diagnostics = {};
  const label = referenceDefense(session, diagnostics)[fullTokenId];
  return { label, ...diagnostics[fullTokenId] };
}

const missingSourceProjection = structuredClone(base);
missingSourceProjection.events = missingSourceProjection.events.filter(
  (event) => event.event_id !== sourceCloud.event_id,
);
assert.equal(missingSourceProjection.expected[fullTokenId], 'full-cascade');
assert.equal(referenceDefense(missingSourceProjection)[fullTokenId], 'job-cascade');
const missingSyncedRead = structuredClone(base);
missingSyncedRead.events = missingSyncedRead.events.filter(
  (event) => event.kind !== 'synced-secret-read' || event.credential_id !== fullToken.credential_id,
);
assert.equal(referenceDefense(missingSyncedRead)[fullTokenId], 'full-cascade');
assert.equal(
  referenceDefense(changedEvent(sourceCloud.event_id, 'credential_version', 'stale-version'))[
    fullTokenId
  ],
  'full-cascade',
);
const missingJobProjection = structuredClone(base);
missingJobProjection.events = missingJobProjection.events.filter(
  (event) => event.event_id !== cloud.event_id,
);
assert.equal(missingJobProjection.expected[fullTokenId], 'full-cascade');
assert.equal(referenceDefense(missingJobProjection)[fullTokenId], 'source-cascade');
const ambiguousSource = structuredClone(base);
ambiguousSource.events.push({ ...sourceCloud, event_id: 'duplicate-source-cloud' });
assert.equal(referenceDefense(ambiguousSource)[fullTokenId], 'job-cascade');
const ambiguousJobCloud = structuredClone(base);
ambiguousJobCloud.events.push({ ...cloud, event_id: 'duplicate-job-cloud' });
assert.equal(referenceDefense(ambiguousJobCloud)[fullTokenId], 'source-cascade');
const missingCheckpoint = structuredClone(base);
missingCheckpoint.events = missingCheckpoint.events.filter(
  (event) => event.event_id !== checkpoint.event_id,
);
assert.equal(diagnosticFor(missingCheckpoint).label, 'full-cascade');
assert.equal(diagnosticFor(missingCheckpoint).kms_outcome, null);
const ambiguousCheckpoint = structuredClone(base);
ambiguousCheckpoint.events.push({ ...checkpoint, event_id: 'duplicate-checkpoint' });
assert.equal(diagnosticFor(ambiguousCheckpoint).label, 'full-cascade');
assert.equal(diagnosticFor(ambiguousCheckpoint).kms_outcome, null);
for (const [eventId, field, value] of [
  [checkpoint.event_id, 'pod_uid', 'wrong-pod'],
  [checkpoint.event_id, 'ciphertext_ref', 'wrong-ciphertext'],
  [brokerRequest.event_id, 'pod_uid', 'wrong-pod'],
  [brokerRequest.event_id, 'checkpoint_ref', 'wrong-checkpoint'],
  [brokerIssue.event_id, 'bound_pod_uid', 'wrong-pod'],
  [brokerIssue.event_id, 'audience', 'wrong-audience'],
  [decryptSts.event_id, 'token_ref', 'wrong-token'],
  [decryptSts.event_id, 'role_arn', 'wrong-role'],
  [decryptSts.event_id, 'session_policy_ref', 'wrong-session-policy'],
  [kmsRequest.event_id, 'cloud_read_ref', 'wrong-cloud'],
  [kmsRequest.event_id, 'encrypted_data_key_ref', 'wrong-blob'],
  [kmsRequest.event_id, 'encryption_context_ref', 'wrong-context'],
]) {
  const result = diagnosticFor(changedEvent(eventId, field, value));
  assert.equal(result.label, 'full-cascade');
  assert.equal(result.kms_outcome, null, `${field} mutation must break KMS evidence`);
}
const noKms = structuredClone(base);
noKms.events = noKms.events.filter(
  (event) => !['kms-decrypt-request', 'kms-decrypt'].includes(event.kind),
);
assert.equal(diagnosticFor(noKms).label, 'full-cascade');
assert.equal(diagnosticFor(noKms).kms_outcome, null);
const changedBrokerPolicy = structuredClone(base);
const brokerSnapshot = changedBrokerPolicy.policySnapshots.find(
  (snapshot) => snapshot.snapshot_ref === brokerRequest.broker_snapshot_ref,
);
brokerSnapshot.policy.profiles.find(
  (profile) => profile.id === brokerRequest.profile_id,
).trust.audience = 'wrong-audience';
assert.equal(diagnosticFor(changedBrokerPolicy).kms_outcome, null);
const changedBrokerPurpose = structuredClone(base);
changedBrokerPurpose.policySnapshots.find(
  (snapshot) => snapshot.snapshot_ref === brokerRequest.broker_snapshot_ref,
).policy.policy.signed_template_purpose = 'wrong-purpose';
assert.equal(diagnosticFor(changedBrokerPurpose).kms_outcome, null);
const changedKeyPolicy = structuredClone(base);
const keySnapshot = changedKeyPolicy.policySnapshots.find(
  (snapshot) => snapshot.snapshot_ref === brokerRequest.key_policy_snapshot_ref,
);
keySnapshot.policy.wrapping_keys.find(
  (entry) => entry.wrapping_key_id === checkpoint.wrapping_key_id,
).key_arn = 'wrong-key';
assert.equal(diagnosticFor(changedKeyPolicy).kms_outcome, null);
const sourceGrant = structuredClone(base);
const sourceWriter = sourceGrant.events.find(
  (event) =>
    event.kind === 'object-spec-write' &&
    event.object_uid === sourceCloud.object_uid &&
    event.revision === sourceCloud.revision,
);
sourceGrant.grantSnapshots
  .find((snapshot) => snapshot.snapshot_ref === sourceCloud.grant_snapshot_ref)
  .grants.find((grant) => grant.writer_principal === sourceWriter.actor).task = {
  action: sourceCloud.action,
  remote_ref: sourceCloud.resource,
};
assert.equal(referenceDefense(sourceGrant)[fullTokenId], 'job-cascade');
const jobGrant = structuredClone(base);
jobGrant.grantSnapshots
  .find((snapshot) => snapshot.snapshot_ref === submission.grant_snapshot_ref)
  .grants.find((grant) => grant.writer_principal === submission.actor).task = {
  action: cloud.action,
  remote_ref: cloud.resource,
};
assert.equal(referenceDefense(jobGrant)[fullTokenId], 'source-cascade');

const approvedKey = Object.keys(base.expected).find(
  (key) => base.expected[key] === 'approved-automation',
);
const falseAlarm = structuredClone(base);
falseAlarm.submitted = { ...referenceDefense(base), [approvedKey]: 'job-cascade' };
assert.equal(scoreDefense(falseAlarm).fp, 1);
assert.equal(scoreDefense(falseAlarm).false_alarm_load, 1);
assert.ok(scoreDefense(falseAlarm).stage_precision.job < 1);
const subtype = structuredClone(base);
subtype.submitted = { ...referenceDefense(base), [fullTokenId]: 'source-cascade' };
assert.equal(scoreDefense(subtype).subtype_errors, 1);
assert.ok(scoreDefense(subtype).stage_recall.job < 1);
const invalid = structuredClone(base);
invalid.submitted = { [fullTokenId]: 'full-cascade' };
assert.equal(scoreDefense(invalid).reason, 'off-grammar');

const queried = buildDefenseSession({ seed: 10492, family: FAMILIES[1] });
for (const kind of new Set(queried.events.map((event) => event.kind))) {
  const response = stepDefense(queried, { tool: 'query-events', args: { kind } });
  assert.equal(response.ok, true);
  assert.ok(response.events.every((event) => event.kind === kind));
}
assert.equal(stepDefense(queried, { tool: 'get-grants' }).ok, true);
assert.equal(stepDefense(queried, { tool: 'get-policy-snapshots' }).ok, true);

console.log('v7 defense self-test passed');
