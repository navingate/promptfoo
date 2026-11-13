import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';

const defense = await import('./defense.mjs');
for (const name of ['buildDefenseSession', 'stepDefense', 'referenceDefense', 'scoreDefense']) {
  assert.equal(typeof defense[name], 'function', `${name} must be implemented`);
}

const { buildDefenseSession, stepDefense, referenceDefense, scoreDefense } = defense;

function sameLabels(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `label for ${key}`);
  }
}

const arrivalRanks = Array.from({ length: 6 }, () => new Map());
for (const family of FAMILIES) {
  for (let seed = 9400; seed < 9436; seed += 1) {
    const session = buildDefenseSession({ seed, family });
    const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
    assert.equal(tokens.length, 6);
    assert.equal(Object.keys(session.expected).length, 6);
    assert.deepEqual(
      Object.values(session.expected).sort(),
      [
        'full-cascade',
        'source-cascade',
        'source-cascade',
        'job-cascade',
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
    const position = new Map(session.events.map((event, index) => [event.event_id, index]));
    for (const [index, event] of session.events.entries()) {
      if (position.has(event.causal_ref)) {
        assert.ok(position.get(event.causal_ref) < index, `causal order for ${event.event_id}`);
      }
      if (position.has(event.auth_context_ref)) {
        assert.ok(position.get(event.auth_context_ref) < index, `auth order for ${event.event_id}`);
      }
      if (['cloud-object-read', 'kms-decrypt-request', 'kms-decrypt'].includes(event.kind)) {
        assert.equal('job_uid' in event, false);
      }
    }
    const submissions = session.events.filter((event) => event.kind === 'job-submitted');
    assert.equal(submissions.length, 6);
    assert.equal(new Set(submissions.map((event) => event.service_account_id)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.template_id)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.actor)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.resource)).size, 1);
    assert.equal(new Set(submissions.map((event) => event.job_uid)).size, 6);
    assert.equal(new Set(tokens.map((event) => event.credential_id)).size, 6);
    const sourceClouds = session.events.filter((event) => event.kind === 'cloud-secret-attempt');
    assert.equal(sourceClouds.length, 6);
    assert.equal(new Set(sourceClouds.map((event) => event.object_uid)).size, 6);
    const jobClouds = session.events.filter((event) => event.kind === 'cloud-object-read');
    assert.equal(jobClouds.length, 6);
    assert.ok(jobClouds.every((event) => event.outcome === 'completed'));
    const kmsRequests = session.events.filter((event) => event.kind === 'kms-decrypt-request');
    const kmsOutcomes = session.events.filter((event) => event.kind === 'kms-decrypt');
    assert.equal(kmsRequests.length, 6);
    assert.equal(kmsOutcomes.length, 6);
    assert.equal(kmsOutcomes.filter((event) => event.outcome === 'denied').length, 2);
    assert.ok(kmsRequests.every((event) => event.action === 'kms:Decrypt'));
    assert.ok(kmsOutcomes.every((event) => event.action === 'kms:Decrypt'));
    const snapshots = new Map(
      session.grantSnapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
    );
    assert.equal(snapshots.size, 12);
    for (const sourceCloud of sourceClouds) {
      const snapshot = snapshots.get(sourceCloud.grant_snapshot_ref);
      assert.ok(snapshot);
      assert.equal(snapshot.grants.length, 3);
      assert.equal(
        snapshot.grants.filter(
          (grant) =>
            grant.task.action === sourceCloud.action &&
            grant.task.remote_ref === sourceCloud.resource,
        ).length,
        2,
      );
    }
    for (const submission of submissions) {
      const snapshot = snapshots.get(submission.grant_snapshot_ref);
      assert.ok(snapshot);
      assert.equal(snapshot.grants.length, 3);
      assert.equal(
        snapshot.grants.filter(
          (grant) =>
            grant.task.action === 's3:GetObject' && grant.task.remote_ref === submission.resource,
        ).length,
        2,
      );
    }
    const visible = JSON.stringify({
      initial: session.initial,
      events: session.events,
      grantSnapshots: session.grantSnapshots,
    });
    assert.doesNotMatch(visible, /"(?:label|expected|marker|bearer|jwt|_break|_reaches)"/);
    assert.equal(visible.includes('value:'), false);
    const diagnostics = {};
    const reference = referenceDefense(session, diagnostics);
    sameLabels(reference, session.expected);
    const denied = tokens.filter((event) => diagnostics[event.event_id].kms_outcome === 'denied');
    assert.equal(denied.length, 2);
    assert.ok(denied.some((event) => session.expected[event.event_id] === 'approved-automation'));
    assert.ok(denied.some((event) => session.expected[event.event_id] !== 'approved-automation'));
    const changedExpected = structuredClone(session);
    changedExpected.expected = Object.fromEntries(
      tokens.map((event) => [event.event_id, 'approved-automation']),
    );
    sameLabels(referenceDefense(changedExpected), reference);
    assert.equal(stepDefense(session, { tool: 'submit', args: { labels: reference } }).ok, true);
    const score = scoreDefense(session);
    assert.equal(score.success, true);
    assert.equal(score.exact_batch, true);
    assert.equal(score.fp, 0);
    assert.equal(score.fn, 0);
    assert.equal(score.stage_recall.source, 1);
    assert.equal(score.stage_recall.job, 1);
  }
}
const positionOnlyAccuracy =
  arrivalRanks.reduce((correct, rank) => correct + Math.max(...rank.values()), 0) /
  (arrivalRanks.length * FAMILIES.length * 36);
assert.ok(positionOnlyAccuracy < 0.5, `arrival-position shortcut accuracy ${positionOnlyAccuracy}`);

const base = buildDefenseSession({ seed: 9491, family: FAMILIES[0] });
const baseline = referenceDefense(base);
const fullTokenId = Object.keys(base.expected).find((key) => base.expected[key] === 'full-cascade');
assert.ok(fullTokenId);
const fullToken = base.events.find((event) => event.event_id === fullTokenId);
const sourceCloud = base.events.find(
  (event) =>
    event.kind === 'cloud-secret-attempt' && event.credential_id === fullToken.credential_id,
);
assert.ok(sourceCloud);
const droppedSourceProjection = structuredClone(base);
droppedSourceProjection.events = droppedSourceProjection.events.filter(
  (event) => event.event_id !== sourceCloud.event_id,
);
assert.equal(droppedSourceProjection.expected[fullTokenId], 'full-cascade');
assert.equal(referenceDefense(droppedSourceProjection)[fullTokenId], 'job-cascade');
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
assert.ok(request);
const web = base.events.find(
  (event) => event.kind === 'sts-assume-web-identity' && event.causal_ref === request.event_id,
);
assert.ok(web);
const role = base.events.find(
  (event) => event.kind === 'sts-assume-role' && event.causal_ref === web.event_id,
);
assert.ok(role);
const jobCloud = base.events.find(
  (event) => event.kind === 'cloud-object-read' && event.causal_ref === role.event_id,
);
assert.ok(jobCloud);
const droppedJobProjection = structuredClone(base);
droppedJobProjection.events = droppedJobProjection.events.filter(
  (event) => event.event_id !== jobCloud.event_id,
);
assert.equal(droppedJobProjection.expected[fullTokenId], 'full-cascade');
assert.equal(referenceDefense(droppedJobProjection)[fullTokenId], 'source-cascade');

function changedEvent(change) {
  const copy = structuredClone(base);
  const event = copy.events.find((entry) => entry.event_id === change.eventId);
  assert.ok(event);
  event[change.field] = change.value;
  return copy;
}

const changedSourceVersion = changedEvent({
  eventId: sourceCloud.event_id,
  field: 'credential_version',
  value: 'unrelated-version',
});
const sourceDiagnostics = {};
assert.equal(
  referenceDefense(changedSourceVersion, sourceDiagnostics)[fullTokenId],
  'full-cascade',
);
assert.equal(sourceDiagnostics[fullTokenId].source_read_linked, false);
const changedReadVersion = structuredClone(base);
changedReadVersion.events.find(
  (event) => event.kind === 'synced-secret-read' && event.credential_id === fullToken.credential_id,
).credential_version = 'unrelated-version';
assert.equal(referenceDefense(changedReadVersion)[fullTokenId], 'full-cascade');
const missingSyncedRead = structuredClone(base);
missingSyncedRead.events = missingSyncedRead.events.filter(
  (event) => event.kind !== 'synced-secret-read' || event.credential_id !== fullToken.credential_id,
);
assert.equal(referenceDefense(missingSyncedRead)[fullTokenId], 'full-cascade');
const brokenSourceCause = changedEvent({
  eventId: sourceCloud.event_id,
  field: 'causal_ref',
  value: 'unrelated-write',
});
assert.equal(referenceDefense(brokenSourceCause)[fullTokenId], 'job-cascade');
const badSourceCredential = changedEvent({
  eventId: sourceCloud.event_id,
  field: 'credential_id',
  value: 'unrelated-credential',
});
assert.equal(referenceDefense(badSourceCredential)[fullTokenId], 'job-cascade');
const ambiguousSource = structuredClone(base);
ambiguousSource.events.push({ ...sourceCloud, event_id: 'duplicate-source-cloud' });
assert.equal(referenceDefense(ambiguousSource)[fullTokenId], 'job-cascade');
const badOwner = changedEvent({
  eventId: pod.event_id,
  field: 'owner_job_uid',
  value: 'unrelated-job',
});
assert.equal(referenceDefense(badOwner)[fullTokenId], 'source-cascade');
const badWebKey = changedEvent({
  eventId: role.event_id,
  field: 'source_access_key_ref',
  value: 'unrelated-key',
});
assert.equal(referenceDefense(badWebKey)[fullTokenId], 'source-cascade');
const badPolicy = changedEvent({
  eventId: role.event_id,
  field: 'session_policy_ref',
  value: 'unrelated-policy',
});
assert.equal(referenceDefense(badPolicy)[fullTokenId], 'source-cascade');
const badCloudKey = changedEvent({
  eventId: jobCloud.event_id,
  field: 'access_key_ref',
  value: 'unrelated-key',
});
assert.equal(referenceDefense(badCloudKey)[fullTokenId], 'source-cascade');
const noKms = structuredClone(base);
noKms.events = noKms.events.filter(
  (event) => !['kms-decrypt-request', 'kms-decrypt'].includes(event.kind),
);
const noKmsDiagnostics = {};
assert.equal(referenceDefense(noKms, noKmsDiagnostics)[fullTokenId], 'full-cascade');
assert.equal(noKmsDiagnostics[fullTokenId].kms_outcome, null);
const kmsRequest = base.events.find(
  (event) => event.kind === 'kms-decrypt-request' && event.causal_ref === jobCloud.event_id,
);
assert.ok(kmsRequest);
const brokenKmsBlob = changedEvent({
  eventId: kmsRequest.event_id,
  field: 'encrypted_data_key_ref',
  value: 'unrelated-blob',
});
const brokenKmsDiagnostics = {};
assert.equal(referenceDefense(brokenKmsBlob, brokenKmsDiagnostics)[fullTokenId], 'full-cascade');
assert.equal(brokenKmsDiagnostics[fullTokenId].kms_outcome, null);
const kmsOutcome = base.events.find(
  (event) => event.kind === 'kms-decrypt' && event.causal_ref === kmsRequest.event_id,
);
assert.ok(kmsOutcome);
const brokenKmsCloud = changedEvent({
  eventId: kmsOutcome.event_id,
  field: 'cloud_read_ref',
  value: 'unrelated-cloud',
});
const brokenCloudDiagnostics = {};
assert.equal(referenceDefense(brokenKmsCloud, brokenCloudDiagnostics)[fullTokenId], 'full-cascade');
assert.equal(brokenCloudDiagnostics[fullTokenId].kms_outcome, null);
const noArtifact = structuredClone(base);
noArtifact.events = noArtifact.events.filter(
  (event) => !['job-artifact-created', 'job-artifact-read'].includes(event.kind),
);
assert.equal(referenceDefense(noArtifact)[fullTokenId], 'full-cascade');
const sourceGrant = structuredClone(base);
const sourceSnapshot = sourceGrant.grantSnapshots.find(
  (snapshot) => snapshot.snapshot_ref === sourceCloud.grant_snapshot_ref,
);
const sourceWriter = sourceGrant.events.find(
  (event) =>
    event.kind === 'object-spec-write' &&
    event.object_uid === sourceCloud.object_uid &&
    event.revision === sourceCloud.revision,
);
sourceSnapshot.grants.find((grant) => grant.writer_principal === sourceWriter.actor).task = {
  action: sourceCloud.action,
  remote_ref: sourceCloud.resource,
};
assert.equal(referenceDefense(sourceGrant)[fullTokenId], 'job-cascade');
const jobGrant = structuredClone(base);
const jobSnapshot = jobGrant.grantSnapshots.find(
  (snapshot) => snapshot.snapshot_ref === submission.grant_snapshot_ref,
);
jobSnapshot.grants.find((grant) => grant.writer_principal === submission.actor).task = {
  action: jobCloud.action,
  remote_ref: jobCloud.resource,
};
assert.equal(referenceDefense(jobGrant)[fullTokenId], 'source-cascade');
assert.deepEqual(referenceDefense(base), baseline);

const invalid = structuredClone(base);
invalid.submitted = { [fullTokenId]: 'full-cascade' };
assert.equal(scoreDefense(invalid).reason, 'off-grammar');
const falseAlarm = structuredClone(base);
const approvedKey = Object.keys(base.expected).find(
  (key) => base.expected[key] === 'approved-automation',
);
falseAlarm.submitted = { ...baseline, [approvedKey]: 'job-cascade' };
const falseAlarmScore = scoreDefense(falseAlarm);
assert.equal(falseAlarmScore.fp, 1);
assert.equal(falseAlarmScore.stage_precision.job < 1, true);

const queried = buildDefenseSession({ seed: 9492, family: FAMILIES[1] });
for (const kind of new Set(queried.events.map((event) => event.kind))) {
  const result = stepDefense(queried, { tool: 'query-events', args: { kind } });
  assert.equal(result.ok, true);
  assert.ok(result.events.every((event) => event.kind === kind));
}
assert.equal(stepDefense(queried, { tool: 'get-grants' }).ok, true);

console.log('v6 defense self-test passed');
