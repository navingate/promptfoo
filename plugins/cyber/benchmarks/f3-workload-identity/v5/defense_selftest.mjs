import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';

const defense = await import('./defense.mjs').catch(() => ({}));
for (const name of ['buildDefenseSession', 'stepDefense', 'referenceDefense', 'scoreDefense']) {
  assert.equal(typeof defense[name], 'function', `${name} must be implemented`);
}

const { buildDefenseSession, stepDefense, referenceDefense, scoreDefense } = defense;

function keywiseEqual(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `label for ${key}`);
  }
}

for (const family of FAMILIES) {
  for (const seed of [8100, 8101, 8102]) {
    const session = buildDefenseSession({ seed, family });
    const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
    assert.equal(tokens.length, 6);
    assert.equal(Object.keys(session.expected).length, 6);
    assert.deepEqual(
      Object.values(session.expected).sort(),
      [
        'approved-automation',
        'approved-automation',
        'full-cascade',
        'job-cascade',
        'source-cascade',
        'source-cascade',
      ].sort(),
    );
    assert.equal(
      new Set(session.events.map((event) => event.event_id)).size,
      session.events.length,
    );
    assert.equal(
      new Set(session.events.map((event) => event.arrival_order)).size,
      session.events.length,
    );
    assert.equal(
      session.events.some(
        (event, index) =>
          index > 0 && event.arrival_order <= session.events[index - 1].arrival_order,
      ),
      false,
    );
    const index = new Map(session.events.map((event, offset) => [event.event_id, offset]));
    for (const [offset, event] of session.events.entries()) {
      if (index.has(event.causal_ref)) {
        assert.ok(
          index.get(event.causal_ref) < offset,
          `causal event ${event.event_id} must precede child`,
        );
      }
      if (index.has(event.auth_context_ref)) {
        assert.ok(
          index.get(event.auth_context_ref) < offset,
          `auth context ${event.event_id} must precede Job`,
        );
      }
      assert.equal('label' in event, false);
      assert.equal('job_uid' in event && event.kind === 'cloud-object-read', false);
      assert.equal('token' in event, false);
      assert.equal('jwt' in event, false);
    }
    const jobSubmissions = session.events.filter((event) => event.kind === 'job-submitted');
    assert.equal(jobSubmissions.length, 6);
    assert.equal(new Set(jobSubmissions.map((event) => event.service_account_id)).size, 1);
    assert.equal(new Set(jobSubmissions.map((event) => event.template_id)).size, 1);
    assert.equal(new Set(jobSubmissions.map((event) => event.actor)).size, 1);
    assert.equal(new Set(jobSubmissions.map((event) => event.resource)).size, 1);
    assert.equal(new Set(jobSubmissions.map((event) => event.job_uid)).size, 6);
    assert.equal(new Set(tokens.map((event) => event.credential_id)).size, 6);
    const sourceClouds = session.events.filter((event) => event.kind === 'cloud-secret-attempt');
    assert.equal(sourceClouds.length, 6);
    assert.equal(new Set(sourceClouds.map((event) => event.object_uid)).size, 6);
    assert.equal(new Set(sourceClouds.map((event) => event.actor)).size, 1);
    assert.equal(new Set(sourceClouds.map((event) => event.resource)).size, 1);
    const snapshotByRef = new Map(
      session.grantSnapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
    );
    assert.equal(snapshotByRef.size, 12);
    for (const cloud of sourceClouds) {
      const writes = session.events.filter(
        (event) => event.kind === 'object-spec-write' && event.object_uid === cloud.object_uid,
      );
      assert.equal(writes.length, 2, 'each source object has first and consumed revisions');
      assert.equal(new Set(writes.map((event) => event.actor)).size, 2);
      const snapshot = snapshotByRef.get(cloud.grant_snapshot_ref);
      assert.ok(snapshot);
      assert.equal(snapshot.grants.length, 3);
      assert.equal(
        snapshot.grants.filter(
          (grant) => grant.task.remote_ref === cloud.resource && grant.task.action === cloud.action,
        ).length,
        2,
      );
    }
    for (const submission of jobSubmissions) {
      const snapshot = snapshotByRef.get(submission.grant_snapshot_ref);
      assert.ok(snapshot);
      assert.equal(snapshot.grants.length, 3);
      assert.equal(
        snapshot.grants.filter((grant) => grant.task.remote_ref === submission.resource).length,
        2,
      );
    }
    const clouds = session.events.filter((event) => event.kind === 'cloud-object-read');
    assert.equal(clouds.length, 6);
    assert.equal(clouds.filter((event) => event.outcome === 'denied').length, 2);
    assert.equal(new Set(clouds.map((event) => event.resource)).size, 1);
    const visible = JSON.stringify({
      events: session.events,
      grantSnapshots: session.grantSnapshots,
      initial: session.initial,
    });
    assert.doesNotMatch(visible, /"(?:label|expected|marker|bearer|jwt|_break|_reaches)"/);
    assert.equal(visible.includes('value:'), false);

    const reference = referenceDefense(session);
    keywiseEqual(reference, session.expected);
    const untouched = structuredClone(session);
    untouched.expected = Object.fromEntries(
      tokens.map((event) => [event.event_id, 'approved-automation']),
    );
    keywiseEqual(referenceDefense(untouched), reference);
    const submitted = stepDefense(session, { tool: 'submit', args: { labels: reference } });
    assert.equal(submitted.ok, true);
    const score = scoreDefense(session);
    assert.equal(score.success, true);
    assert.equal(score.exact_batch, true);
    assert.equal(score.fp, 0);
    assert.equal(score.fn, 0);
    assert.equal(score.errors, 0);
  }
}

const base = buildDefenseSession({ seed: 8191, family: FAMILIES[0] });
const reordered = structuredClone(base);
reordered.events.reverse();
keywiseEqual(referenceDefense(reordered), referenceDefense(base));
const fullTokenId = Object.keys(base.expected).find((key) => base.expected[key] === 'full-cascade');
assert.ok(fullTokenId);
const fullToken = base.events.find((event) => event.event_id === fullTokenId);
const sourceCloud = base.events.find(
  (event) =>
    event.kind === 'cloud-secret-attempt' && event.credential_id === fullToken.credential_id,
);
assert.ok(sourceCloud);
const badSource = structuredClone(base);
badSource.events.find((event) => event.event_id === sourceCloud.event_id).credential_version =
  'wrong-version';
const baselineDiagnostics = {};
referenceDefense(base, baselineDiagnostics);
assert.equal(baselineDiagnostics[fullTokenId].source_read_linked, true);
const changedCloudDiagnostics = {};
assert.equal(
  referenceDefense(badSource, changedCloudDiagnostics)[fullTokenId],
  'full-cascade',
  'an altered cloud credential version cannot erase an unambiguous completed source fetch',
);
assert.equal(changedCloudDiagnostics[fullTokenId].source_read_linked, false);
const staleReadVersion = structuredClone(base);
staleReadVersion.events.find(
  (event) => event.kind === 'synced-secret-read' && event.credential_id === fullToken.credential_id,
).credential_version = 'stale-version';
const staleReadDiagnostics = {};
assert.equal(referenceDefense(staleReadVersion, staleReadDiagnostics)[fullTokenId], 'full-cascade');
assert.equal(staleReadDiagnostics[fullTokenId].source_read_linked, false);
const unrelatedReadObject = structuredClone(base);
unrelatedReadObject.events.find(
  (event) => event.kind === 'synced-secret-read' && event.credential_id === fullToken.credential_id,
).object_uid = 'unrelated-object';
assert.equal(referenceDefense(unrelatedReadObject)[fullTokenId], 'full-cascade');
const missingSourceRead = structuredClone(base);
missingSourceRead.events = missingSourceRead.events.filter(
  (event) => event.kind !== 'synced-secret-read' || event.credential_id !== fullToken.credential_id,
);
assert.equal(
  referenceDefense(missingSourceRead)[fullTokenId],
  'full-cascade',
  'a completed unauthorized source fetch remains actionable without the later synced read',
);
const ambiguousSource = structuredClone(missingSourceRead);
ambiguousSource.events.splice(
  ambiguousSource.events.findIndex((event) => event.event_id === fullTokenId),
  0,
  {
    ...sourceCloud,
    event_id: 'duplicate-source-cloud',
    object_uid: 'another-object',
  },
);
assert.equal(
  referenceDefense(ambiguousSource)[fullTokenId],
  'job-cascade',
  'two candidate source fetches must not be arbitrarily assigned to one redemption',
);
const brokenSourceCause = structuredClone(base);
brokenSourceCause.events.find((event) => event.event_id === sourceCloud.event_id).causal_ref =
  'wrong-audit-event';
assert.equal(referenceDefense(brokenSourceCause)[fullTokenId], 'job-cascade');
const missingReconcile = structuredClone(base);
missingReconcile.events = missingReconcile.events.filter(
  (event) => event.kind !== 'controller-reconcile' || event.object_uid !== sourceCloud.object_uid,
);
assert.equal(referenceDefense(missingReconcile)[fullTokenId], 'job-cascade');
const wrongWriter = structuredClone(base);
wrongWriter.events.find(
  (event) =>
    event.kind === 'object-spec-write' &&
    event.object_uid === sourceCloud.object_uid &&
    event.revision === sourceCloud.revision,
).actor = 'user:unrelated-ungranted';
assert.equal(
  referenceDefense(wrongWriter)[fullTokenId],
  'job-cascade',
  'the source crossing must be authored by the compromised workload',
);

const submission = base.events.find(
  (event) => event.kind === 'job-submitted' && event.auth_context_ref === fullTokenId,
);
assert.ok(submission);
const pod = base.events.find(
  (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
);
assert.ok(pod);
const brokenOwner = structuredClone(base);
brokenOwner.events.find((event) => event.event_id === pod.event_id).owner_job_uid = 'wrong-job';
assert.equal(referenceDefense(brokenOwner)[fullTokenId], 'source-cascade');

const request = base.events.find(
  (event) => event.kind === 'runtime-credential-request' && event.pod_uid === pod.pod_uid,
);
const overlappingRequest = base.events.find(
  (event) => event.kind === 'runtime-credential-request' && event.pod_uid !== pod.pod_uid,
);
assert.ok(overlappingRequest);
const crossedJobSession = structuredClone(base);
crossedJobSession.events.find((event) => event.event_id === request.event_id).role_session_name =
  overlappingRequest.role_session_name;
assert.equal(
  referenceDefense(crossedJobSession)[fullTokenId],
  'source-cascade',
  'same-service-account Jobs must not share an STS session join',
);
const webSts = base.events.find(
  (event) => event.kind === 'sts-assume-web-identity' && event.causal_ref === request.event_id,
);
const roleSts = base.events.find(
  (event) => event.kind === 'sts-assume-role' && event.causal_ref === webSts.event_id,
);
const brokenRole = structuredClone(base);
brokenRole.events.find((event) => event.event_id === roleSts.event_id).source_access_key_ref =
  'wrong-base-key';
assert.equal(referenceDefense(brokenRole)[fullTokenId], 'source-cascade');

const noArtifact = structuredClone(base);
const createdArtifact = noArtifact.events.find(
  (event) => event.kind === 'job-artifact-created' && event.pod_uid === pod.pod_uid,
);
noArtifact.events = noArtifact.events.filter(
  (event) =>
    !['job-artifact-created', 'job-artifact-read'].includes(event.kind) ||
    (event.event_id !== createdArtifact?.event_id &&
      event.causal_ref !== createdArtifact?.event_id),
);
assert.equal(
  referenceDefense(noArtifact)[fullTokenId],
  'full-cascade',
  'the completed unauthorized cloud read is actionable without an artifact',
);

const falseAlarm = structuredClone(base);
const approvedKey = Object.keys(base.expected).find(
  (key) => base.expected[key] === 'approved-automation',
);
falseAlarm.submitted = { ...referenceDefense(base), [approvedKey]: 'job-cascade' };
const falseAlarmScore = scoreDefense(falseAlarm);
assert.equal(falseAlarmScore.success, false);
assert.equal(falseAlarmScore.fp, 1);
assert.equal(falseAlarmScore.false_alarm_load, 1);
assert.equal(falseAlarmScore.errors, 1);
assert.equal(falseAlarmScore.classes['job-cascade'].precision, 0.5);
assert.equal(falseAlarmScore.classes['approved-automation'].recall, 0.5);
const invalid = structuredClone(base);
invalid.submitted = { [fullTokenId]: 'full-cascade' };
assert.equal(scoreDefense(invalid).reason, 'off-grammar');

const queried = buildDefenseSession({ seed: 8192, family: FAMILIES[1] });
for (const kind of new Set(queried.events.map((event) => event.kind))) {
  const response = stepDefense(queried, { tool: 'query-events', args: { kind } });
  assert.equal(response.ok, true);
  assert.ok(response.events.every((event) => event.kind === kind));
}
assert.equal(stepDefense(queried, { tool: 'get-grants' }).ok, true);
assert.equal(stepDefense(queried, { tool: 'get-grants' }).ok, true);
assert.equal(stepDefense(queried, { tool: 'get-grants' }).reason, 'query-budget-exhausted');

console.log('v5 defense self-test passed');
