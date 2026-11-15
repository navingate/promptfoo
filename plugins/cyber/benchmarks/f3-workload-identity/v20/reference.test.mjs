import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode as buildV19Episode } from '../v19/producer.mjs';
import { planReferenceContainment as planV19 } from '../v19/reference.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';

function episode(seed = 48000, family = FAMILIES[0]) {
  return buildEpisode({ seed, family });
}

function actionKey(action) {
  return JSON.stringify([action.tool, action.args]);
}

function requiredActions(native) {
  const baseline = replayContainment(native, []);
  const attempts = new Map(native.attempts.map((attempt) => [attempt.attempt_id, attempt]));
  return baseline.attempt_results
    .filter((result) => result.source_approved === false || !result.job_approved)
    .map((result) => {
      const attempt = attempts.get(result.attempt_id);
      return result.kind === 'renewal'
        ? { tool: 'pause-job', args: { job_uid: result.job_uid } }
        : {
            tool: 'deny-role-session',
            args: { role_arn: attempt.role_arn, role_session_name: attempt.role_session_name },
          };
    })
    .map(actionKey)
    .sort();
}

test('visible-only planner matches native source and Job decisions on development and holdout grids', () => {
  for (const firstSeed of [48000, 49000]) {
    for (let seed = firstSeed; seed < firstSeed + 12; seed += 1) {
      for (const family of FAMILIES) {
        const { visible, native } = episode(seed, family);
        const actions = planReferenceContainment(visible);
        const replay = replayContainment(native, actions);
        assert.equal(replay.success, true, `${seed}/${family}: ${JSON.stringify(replay)}`);
        assert.deepEqual(
          actions.map(actionKey).sort(),
          requiredActions(native),
          `${seed}/${family}: response actions differ from native per-plan decisions`,
        );
        assert.deepEqual(
          actions,
          planV19(buildV19Episode({ seed, family }).visible),
          `${seed}/${family}: v19 and v20 response actions differ`,
        );
      }
    }
  }
});

test('requires exactly one completed pre-redemption synced read and matching source fetch', () => {
  const { visible } = episode();
  const token = visible.events.find((event) => event.kind === 'release-token-redeemed');
  const reads = visible.events
    .filter(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.actor === token.actor &&
        event.credential_id === token.credential_id &&
        event.event_time < token.event_time,
    )
    .sort((left, right) => right.event_time - left.event_time);
  assert.ok(reads.length >= 2, 'test requires an older source read decoy');
  const removed = structuredClone(visible);
  removed.events = removed.events.filter((event) => event.event_id !== reads[0].event_id);
  assert.throws(
    () => planReferenceContainment(removed),
    /source|read|fetch|lineage|ambiguous|missing/u,
  );

  const duplicated = structuredClone(visible);
  duplicated.events.push({ ...reads[0], event_id: 'duplicate-synced-read' });
  assert.throws(() => planReferenceContainment(duplicated), /source|read|lineage|ambiguous/u);

  const wrongVersion = structuredClone(visible);
  wrongVersion.events.find((event) => event.event_id === reads[0].event_id).credential_version =
    'unmatched-version';
  assert.throws(
    () => planReferenceContainment(wrongVersion),
    /source|fetch|lineage|ambiguous|missing/u,
  );
});

test('ignores a newer unrelated synced read when enumerating complete source paths', () => {
  const { visible } = episode();
  const expected = planReferenceContainment(visible);
  const token = visible.events.find((event) => event.kind === 'release-token-redeemed');
  const exactRead = visible.events
    .filter(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.actor === token.actor &&
        event.credential_id === token.credential_id &&
        event.event_time < token.event_time,
    )
    .sort((left, right) => right.event_time - left.event_time)[0];
  const decoy = structuredClone(visible);
  const moved = decoy.events.find((event) => event.event_id === exactRead.event_id);
  moved.event_time -= 1;
  moved.arrival_order -= 1;
  decoy.events.push({
    ...exactRead,
    event_id: 'later-unrelated-synced-read',
    object_uid: 'unrelated-object',
    credential_version: 'unrelated-version',
  });
  assert.deepEqual(planReferenceContainment(decoy), expected);
});

test('refuses ambiguous authenticated source writer and missing source grant snapshot', () => {
  const { visible } = episode();
  const token = visible.events.find((event) => event.kind === 'release-token-redeemed');
  const synced = visible.events
    .filter(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.outcome === 'completed' &&
        event.actor === token.actor &&
        event.credential_id === token.credential_id &&
        event.event_time < token.event_time,
    )
    .sort((left, right) => right.event_time - left.event_time)[0];
  const fetch = visible.events.find(
    (event) =>
      event.kind === 'cloud-secret-attempt' &&
      event.outcome === 'completed' &&
      event.credential_id === token.credential_id &&
      event.credential_version === synced.credential_version &&
      event.object_uid === synced.object_uid &&
      event.revision === synced.revision &&
      event.resource === token.credential_ref,
  );
  const write = visible.events.find(
    (event) =>
      event.kind === 'object-spec-write' &&
      event.object_uid === fetch.object_uid &&
      event.revision === fetch.revision,
  );
  const duplicate = structuredClone(visible);
  duplicate.events.push({ ...write, event_id: 'duplicate-source-write' });
  assert.throws(() => planReferenceContainment(duplicate), /source|write|lineage|ambiguous/u);

  const noSourceGrant = structuredClone(visible);
  noSourceGrant.grant_snapshots = noSourceGrant.grant_snapshots.filter(
    (snapshot) => snapshot.snapshot_ref !== fetch.grant_snapshot_ref,
  );
  assert.throws(() => planReferenceContainment(noSourceGrant), /source|snapshot|grant|missing/u);
});

test('requires one current approval for every admitted Job lane and its admission stream', () => {
  const { visible } = episode();
  const missing = structuredClone(visible);
  missing.current_job_approvals.pop();
  assert.throws(() => planReferenceContainment(missing), /approval|lane|missing|incomplete/u);

  const duplicate = structuredClone(visible);
  duplicate.current_job_approvals.push(structuredClone(duplicate.current_job_approvals[0]));
  assert.throws(() => planReferenceContainment(duplicate), /approval|lane|ambiguous/u);

  const wrongStream = structuredClone(visible);
  wrongStream.current_job_approvals[0].approval_stream_ref = 'unmatched-stream';
  assert.throws(() => planReferenceContainment(wrongStream), /approval|stream|lineage/u);
});

test('requires unique issued-session lineage and a matching runtime policy', () => {
  const { visible } = episode();
  const session = visible.session_register.find((item) => item.active_plan);
  assert.ok(session);
  const duplicateRole = structuredClone(visible);
  const role = duplicateRole.events.find(
    (event) => event.kind === 'sts-assume-role' && event.access_key_ref === session.access_key_ref,
  );
  duplicateRole.events.push({ ...role, event_id: 'duplicate-role-assumption' });
  assert.throws(() => planReferenceContainment(duplicateRole), /session|STS|lineage|ambiguous/u);

  const missingPolicy = structuredClone(visible);
  missingPolicy.policy_snapshots = [];
  assert.throws(() => planReferenceContainment(missingPolicy), /policy|missing/u);

  const duplicatePolicy = structuredClone(visible);
  duplicatePolicy.policy_snapshots.push(structuredClone(duplicatePolicy.policy_snapshots[0]));
  assert.throws(() => planReferenceContainment(duplicatePolicy), /policy|ambiguous/u);
});

test('requires every release token to map to exactly one admitted Job', () => {
  const { visible } = episode();
  const duplicateMapping = structuredClone(visible);
  const releaseSubmissions = duplicateMapping.events.filter(
    (event) =>
      event.kind === 'job-submitted' &&
      duplicateMapping.events.some(
        (context) =>
          context.event_id === event.auth_context_ref && context.kind === 'release-token-redeemed',
      ),
  );
  assert.equal(releaseSubmissions.length, 3);
  releaseSubmissions[0].auth_context_ref = releaseSubmissions[1].auth_context_ref;
  assert.throws(
    () => planReferenceContainment(duplicateMapping),
    /token|authorization|lineage|ambiguous/u,
  );
});

test('rejects missing authenticated write/reconcile causal link', () => {
  const { visible } = episode();
  const token = visible.events.find((event) => event.kind === 'release-token-redeemed');
  const synced = visible.events
    .filter(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.actor === token.actor &&
        event.credential_id === token.credential_id &&
        event.event_time < token.event_time,
    )
    .sort((left, right) => right.event_time - left.event_time)[0];
  const fetch = visible.events.find(
    (event) =>
      event.kind === 'cloud-secret-attempt' &&
      event.credential_id === token.credential_id &&
      event.credential_version === synced.credential_version &&
      event.object_uid === synced.object_uid &&
      event.revision === synced.revision &&
      event.resource === token.credential_ref,
  );
  const missingLink = structuredClone(visible);
  const write = missingLink.events.find(
    (event) =>
      event.kind === 'object-spec-write' &&
      event.object_uid === fetch.object_uid &&
      event.revision === fetch.revision,
  );
  const reconcile = missingLink.events.find(
    (event) =>
      event.kind === 'controller-reconcile' &&
      event.outcome === 'completed' &&
      event.object_uid === fetch.object_uid &&
      event.revision === fetch.revision &&
      event.causal_ref === write.causal_ref,
  );
  assert.ok(reconcile);
  delete write.causal_ref;
  delete reconcile.causal_ref;
  assert.throws(() => planReferenceContainment(missingLink), /source|causal|lineage|missing/u);
});

test('validates a source-bad Job plan even when source taint already requires containment', () => {
  const { visible, native } = episode();
  const sourceBadJob = replayContainment(native, []).source_provenance_results.find(
    (item) => item.source_approved === false,
  ).job_uid;
  const invalid = structuredClone(visible);
  const queued = invalid.job_queue.find(
    (item) => item.job_uid === sourceBadJob && item.renewal_plan,
  );
  assert.ok(queued);
  queued.renewal_plan.planned_at = invalid.horizon_end + 1;
  assert.throws(() => planReferenceContainment(invalid), /plan|horizon|policy/u);
});

test('requires both Job lanes, exact template scope, and membership before the planned read', () => {
  const { visible, native } = episode();
  const cleanActive = replayContainment(native, []).attempt_results.find(
    (item) => item.kind === 'active' && item.authorized,
  );
  assert.ok(cleanActive);
  const attempt = native.attempts.find((item) => item.attempt_id === cleanActive.attempt_id);
  const session = visible.session_register.find(
    (item) => item.role_session_name === attempt.role_session_name && item.active_plan,
  );
  const submission = visible.events.find(
    (item) => item.kind === 'job-submitted' && item.job_uid === attempt.job_uid,
  );
  assert.ok(session && submission);
  const mutated = structuredClone(visible);
  const owner = mutated.current_job_approvals.find(
    (item) => item.job_uid === attempt.job_uid && item.lane === 'owner',
  );
  const covering = owner.grants.find(
    (grant) =>
      grant.task.action === session.active_plan.action &&
      grant.task.remote_ref === session.active_plan.resource &&
      grant.scope.service_account_id === submission.service_account_id &&
      grant.scope.template_id === submission.template_id &&
      grant.scope.valid_from <= session.active_plan.planned_at &&
      session.active_plan.planned_at < grant.scope.valid_until,
  );
  assert.ok(covering);
  owner.grants = [{ ...covering, writer_principal: 'group:v20-boundary-test' }];
  const membership = {
    audit_stream_ref: owner.audit_stream_ref,
    group_principal: 'group:v20-boundary-test',
    member_principal: submission.actor,
    kind: 'group-member-added',
    outcome: 'completed',
    event_time: session.active_plan.planned_at - 1,
    arrival_order: 9999,
  };
  mutated.membership_audit.push(membership);
  const deny = actionKey({
    tool: 'deny-role-session',
    args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
  });
  assert.equal(planReferenceContainment(mutated).map(actionKey).includes(deny), false);
  membership.event_time = session.active_plan.planned_at;
  assert.equal(planReferenceContainment(mutated).map(actionKey).includes(deny), true);
  membership.event_time -= 1;
  owner.grants[0].scope.template_id = 'unmatched-template';
  assert.equal(planReferenceContainment(mutated).map(actionKey).includes(deny), true);
});

test('refuses paired missing STS and approval stream references', () => {
  const { visible } = episode();
  const missingSts = structuredClone(visible);
  const session = missingSts.session_register.find((item) => item.active_plan);
  const role = missingSts.events.find(
    (event) => event.kind === 'sts-assume-role' && event.access_key_ref === session.access_key_ref,
  );
  const web = missingSts.events.find(
    (event) =>
      event.kind === 'sts-assume-web-identity' &&
      event.access_key_ref === role.source_access_key_ref,
  );
  assert.ok(role && web);
  delete role.source_access_key_ref;
  delete web.access_key_ref;
  assert.throws(
    () => planReferenceContainment(missingSts),
    /STS|session|identity|lineage|missing/u,
  );

  const missingApprovalStream = structuredClone(visible);
  const admission = missingApprovalStream.events.find((event) => event.kind === 'job-admission');
  const approval = missingApprovalStream.current_job_approvals.find(
    (item) => item.job_uid === admission.job_uid && item.lane === 'change',
  );
  delete admission.approval_stream_ref;
  delete approval.approval_stream_ref;
  assert.throws(
    () => planReferenceContainment(missingApprovalStream),
    /approval|stream|lineage|missing/u,
  );
});
