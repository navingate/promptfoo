import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOffenseSession } from '../v4/offense.mjs';
import { authorizeJobWorld, createJobWorld, referenceJobRoute, stepJob } from '../v9/job.mjs';
import {
  createApprovalStream,
  deriveApprovalStreamRef,
  publishApprovalRevision,
  selectEffectiveApproval,
} from './approval_plane.mjs';

function grant(resource) {
  return {
    grant_id: `grant-${resource}`,
    writer_principal: 'employee',
    task: { action: 's3:GetObject', remote_ref: resource },
    scope: {
      service_account_id: 'sa',
      template_id: 'template',
      valid_from: 0,
      valid_until: 100,
    },
  };
}

function stream(recordRef, baseSnapshotRef, grants = [grant('target')]) {
  return createApprovalStream({
    seed: 35001,
    family: 'reconcile-hook',
    recordRef,
    baseSnapshotRef,
    grants,
    auditStreamRef: 'membership-stream',
  });
}

test('native approval versions are immutable and selected by completed event time', () => {
  const baseGrants = [grant('target')];
  const item = stream('change-1', 'submission-snapshot', baseGrants);
  baseGrants[0].task.remote_ref = 'mutated-input';
  assert.equal(item.snapshots[0].grants[0].task.remote_ref, 'target');

  const failedCandidate = [grant('operational')];
  const failed = publishApprovalRevision(item, {
    grants: failedCandidate,
    eventTime: 12,
    arrivalOrder: 30,
    outcome: 'failed',
  });
  failedCandidate[0].task.remote_ref = 'mutated-after-publication';
  assert.equal(failed.previous_snapshot_ref, 'submission-snapshot');
  assert.equal(selectEffectiveApproval(item, 13).snapshot_ref, 'submission-snapshot');

  const completed = publishApprovalRevision(item, {
    grants: [grant('operational')],
    eventTime: 20,
    arrivalOrder: 1,
    outcome: 'completed',
  });
  assert.equal(completed.previous_snapshot_ref, 'submission-snapshot');
  assert.equal(selectEffectiveApproval(item, 20).snapshot_ref, 'submission-snapshot');
  assert.equal(selectEffectiveApproval(item, 21).snapshot_ref, completed.new_snapshot_ref);
  assert.equal(selectEffectiveApproval(item, 21).grants[0].task.remote_ref, 'operational');
  assert.equal(item.snapshots[0].approval_stream_ref, item.approval_stream_ref);
  assert.equal(item.snapshots[1].approval_stream_ref, item.approval_stream_ref);
  assert.equal(item.snapshots[2].approval_stream_ref, item.approval_stream_ref);
});

test('independent approval lanes never cross streams and reject ambiguous chronology', () => {
  const change = stream('change-2', 'change-base');
  const owner = stream('owner-2', 'owner-base', [grant('operational')]);
  assert.notEqual(change.approval_stream_ref, owner.approval_stream_ref);
  publishApprovalRevision(change, {
    grants: [grant('operational')],
    eventTime: 15,
    arrivalOrder: 3,
    outcome: 'completed',
  });
  assert.equal(selectEffectiveApproval(owner, 20).snapshot_ref, 'owner-base');
  assert.throws(() =>
    publishApprovalRevision(change, {
      grants: [grant('target')],
      eventTime: 15,
      arrivalOrder: 4,
      outcome: 'completed',
    }),
  );
  assert.throws(() =>
    publishApprovalRevision(change, {
      grants: [grant('target')],
      eventTime: 14,
      arrivalOrder: 4,
      outcome: 'completed',
    }),
  );
});

test('a marked stale-predecessor failure cannot replace an effective completed snapshot', () => {
  const item = stream('change-stale', 'base');
  const completed = publishApprovalRevision(item, {
    grants: [grant('operational')],
    eventTime: 20,
    arrivalOrder: 1,
    outcome: 'completed',
  });
  item.snapshots.push({
    snapshot_ref: 'candidate',
    approval_stream_ref: item.approval_stream_ref,
    audit_stream_ref: 'membership-stream',
    grants: [grant('target')],
  });
  const failure = {
    event_id: 'failed-stale-change',
    approval_stream_ref: item.approval_stream_ref,
    previous_snapshot_ref: 'base',
    new_snapshot_ref: 'candidate',
    event_time: 30,
    arrival_order: 40,
    outcome: 'failed',
    failure_reason: 'stale-predecessor',
  };
  item.publications.push(failure);
  assert.equal(selectEffectiveApproval(item, 31).snapshot_ref, completed.new_snapshot_ref);
  failure.failure_reason = undefined;
  assert.throws(() => selectEffectiveApproval(item, 31), /predecessor/u);
  failure.failure_reason = 'stale-predecessor';
  failure.previous_snapshot_ref = 'unknown';
  assert.throws(() => selectEffectiveApproval(item, 31), /predecessor/u);
});

function jobWorld(seed = 35001) {
  const nonce = `v17-native-${seed}`;
  const session = createOffenseSession({ seed, family: 'reconcile-hook', nonce });
  const world = createJobWorld(session.release.world, session.release.initial.principal, {
    instanceId: nonce,
    expectedCredentialId: session.source.world.meta.credential_id,
  });
  const redeemed = {
    event_id: `redeem-${nonce}`,
    event_time: 50,
    kind: 'release-token-redeemed',
    outcome: 'completed',
    granted_principal: world.principal,
    granted_namespace: world.policy.namespace,
    credential_id: world.expectedCredentialId,
  };
  assert.equal(authorizeJobWorld(world, redeemed), true);
  return world;
}

function submit(world, route) {
  const result = stepJob(world, {
    tool: 'submit-job',
    args: {
      namespace: route.namespace,
      service_account_id: route.service_account_id,
      template_id: route.template_id,
      object_ref: route.object_ref,
      access_point_alias: route.access_point_alias,
      approval_stream_ref: 'attacker-controlled-stream',
      owner_approval_stream_ref: 'attacker-controlled-owner-stream',
      owner_snapshot_ref: 'attacker-controlled-owner-snapshot',
    },
  });
  assert.equal(result.ok, true, result.reason);
  return result;
}

test('admission binds a trusted approval stream and two reads have a real event-time gap', () => {
  for (const before of [true, false]) {
    const world = jobWorld(before ? 35001 : 35002);
    const route = referenceJobRoute(world);
    world.defenseApprovalStreamRef = deriveApprovalStreamRef({
      seed: world.releaseWorld.meta.seed,
      family: world.releaseWorld.meta.family,
      recordRef: `change-${world.instanceId}`,
    });
    world.defenseOwnerApprovalStreamRef = deriveApprovalStreamRef({
      seed: world.releaseWorld.meta.seed,
      family: world.releaseWorld.meta.family,
      recordRef: `owner-${world.instanceId}`,
    });
    world.defenseBetweenReadInterval = 4;
    world.defenseOperationalRead = { before, capture: false };
    world.defenseOperationalCheckpoint = true;
    const created = submit(world, route);
    const admission = world.events.find(
      (event) => event.kind === 'job-admission' && event.job_uid === created.job_uid,
    );
    assert.equal(admission.approval_stream_ref, world.defenseApprovalStreamRef);
    assert.equal(admission.owner_approval_stream_ref, world.defenseOwnerApprovalStreamRef);
    assert.notEqual(admission.approval_stream_ref, 'attacker-controlled-stream');
    assert.notEqual(admission.owner_approval_stream_ref, 'attacker-controlled-owner-stream');
    const submission = world.events.find(
      (event) => event.kind === 'job-submitted' && event.job_uid === created.job_uid,
    );
    assert.match(submission.owner_snapshot_ref, /^ownersnap-[a-f0-9]{16}$/u);
    assert.notEqual(submission.owner_snapshot_ref, 'attacker-controlled-owner-snapshot');
    const run = stepJob(world, { tool: 'run-job', args: { job_uid: created.job_uid } });
    assert.equal(run.status, 'checkpoint', run.reason);
    const reads = world.events
      .filter((event) => event.kind === 'cloud-object-read' && event.outcome === 'completed')
      .sort((left, right) => left.event_time - right.event_time);
    assert.equal(reads.length, 2);
    assert.ok(reads[1].event_time - reads[0].event_time >= 5);
    assert.equal(reads[0].access_key_ref, reads[1].access_key_ref);
    for (const read of reads) {
      assert.equal('grant_snapshot_ref' in read, false);
      assert.equal('approval_stream_ref' in read, false);
      assert.equal('authorized' in read, false);
    }
  }
});

test('legacy Job admissions and read scheduling are unaffected without v17 flags', () => {
  const world = jobWorld(35003);
  const route = referenceJobRoute(world);
  world.defenseOperationalRead = { before: false, capture: false };
  world.defenseOperationalCheckpoint = true;
  const created = submit(world, route);
  const admission = world.events.find(
    (event) => event.kind === 'job-admission' && event.job_uid === created.job_uid,
  );
  assert.equal('approval_stream_ref' in admission, false);
  assert.equal('owner_approval_stream_ref' in admission, false);
  const submission = world.events.find(
    (event) => event.kind === 'job-submitted' && event.job_uid === created.job_uid,
  );
  assert.equal('owner_snapshot_ref' in submission, false);
  const run = stepJob(world, { tool: 'run-job', args: { job_uid: created.job_uid } });
  assert.equal(run.status, 'checkpoint', run.reason);
  const reads = world.events
    .filter((event) => event.kind === 'cloud-object-read' && event.outcome === 'completed')
    .sort((left, right) => left.event_time - right.event_time);
  assert.equal(reads.length, 2);
  assert.equal(reads[1].event_time - reads[0].event_time, 1);
});

test('denied Job admission never binds an effective approval stream', () => {
  const world = jobWorld(35004);
  const route = referenceJobRoute(world);
  world.defenseApprovalStreamRef = deriveApprovalStreamRef({
    seed: 35004,
    family: 'reconcile-hook',
    recordRef: 'change-denied',
  });
  world.defenseOwnerApprovalStreamRef = deriveApprovalStreamRef({
    seed: 35004,
    family: 'reconcile-hook',
    recordRef: 'owner-denied',
  });
  const denied = stepJob(world, {
    tool: 'submit-job',
    args: {
      namespace: route.namespace,
      service_account_id: route.service_account_id,
      template_id: route.template_id,
      object_ref: route.object_ref,
      access_point_alias: 'invalid-access-point',
    },
  });
  assert.equal(denied.ok, false);
  const admission = world.events.find((event) => event.kind === 'job-admission');
  assert.equal(admission.outcome, 'denied');
  assert.equal('approval_stream_ref' in admission, false);
  assert.equal('owner_approval_stream_ref' in admission, false);
});
