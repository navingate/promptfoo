import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession as buildV8DefenseSession } from '../v8/defense.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';

const v8Baseline = buildV8DefenseSession({ seed: 10400, family: FAMILIES[0] });
for (const [kind, time] of [
  ['controller-reconcile', 3],
  ['cloud-secret-attempt', 4],
  ['synced-secret-read', 5],
  ['release-token-redeemed', 6],
]) {
  assert.deepEqual(
    [
      ...new Set(
        v8Baseline.events.filter((event) => event.kind === kind).map((event) => event.event_time),
      ),
    ],
    [time],
  );
}

function auditTimes(session, snapshotRef, actor) {
  const snapshot = session.grantSnapshots.find((item) => item.snapshot_ref === snapshotRef);
  assert.ok(snapshot);
  const events = session.membershipAudit.filter(
    (event) =>
      event.audit_stream_ref === snapshot.audit_stream_ref && event.member_principal === actor,
  );
  const added = events.find((event) => event.kind === 'group-member-added');
  const removed = events.find((event) => event.kind === 'group-member-removed');
  assert.ok(added);
  assert.ok(removed);
  return { added: added.event_time, removed: removed.event_time };
}

function bestBalancedLookup(samples) {
  const positives = samples.filter((sample) => sample.authorized).length;
  const negatives = samples.length - positives;
  assert.ok(positives > 0 && negatives > 0);
  const groups = new Map();
  for (const { signature, authorized } of samples) {
    const counts = groups.get(signature) ?? { positives: 0, negatives: 0 };
    counts[authorized ? 'positives' : 'negatives'] += 1;
    groups.set(signature, counts);
  }
  let truePositives = 0;
  let trueNegatives = 0;
  for (const counts of groups.values()) {
    if (counts.positives / positives >= counts.negatives / negatives) {
      truePositives += counts.positives;
    } else {
      trueNegatives += counts.negatives;
    }
  }
  return (truePositives / positives + trueNegatives / negatives) / 2;
}

function assertSameConditionalDistribution(samples, name) {
  const positives = samples.filter((sample) => sample.authorized).length;
  const negatives = samples.length - positives;
  const groups = new Map();
  for (const { signature, authorized } of samples) {
    const counts = groups.get(signature) ?? { positives: 0, negatives: 0 };
    counts[authorized ? 'positives' : 'negatives'] += 1;
    groups.set(signature, counts);
  }
  for (const [signature, counts] of groups) {
    assert.equal(
      counts.positives * negatives,
      counts.negatives * positives,
      `${name} signature ${signature} differs by authorization`,
    );
  }
}

const jobGapSamples = [];
const jobAuditSamples = [];
const jobTimeSamples = [];
const signedReadDeltaSamples = [];
const jobQueueSamples = [];
const backgroundQueueSamples = [];
const sourceAuditSamples = [];
const sourceTimeSamples = [];
const sourceQueueSamples = [];
const adjacentAuditSamples = new Map(
  [
    'source-reconcile',
    'source-synced-read',
    'job-pod',
    'job-runtime-request',
    'job-web-sts',
    'job-role-sts',
    'job-checkpoint',
  ].map((kind) => [kind, []]),
);
function recordAdjacent(kind, event, addTime, authorized) {
  assert.ok(event, `missing ${kind} event`);
  adjacentAuditSamples.get(kind).push({
    signature: String(event.event_time - addTime),
    authorized,
  });
}
let firstByEventTimeCorrect = 0;
let pairs = 0;
const producerGaps = {
  sourceCloud: new Set(),
  sourceRead: new Set(),
  jobCloud: new Set(),
  jobCheckpoint: new Set(),
};
for (const family of FAMILIES) {
  for (let seed = 10400; seed < 10436; seed += 1) {
    const session = buildDefenseSession({ seed, family });
    assert.deepEqual(referenceDefense(session), session.expected);
    const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
    const byId = new Map(session.events.map((event) => [event.event_id, event]));
    const timeOrderByAuthorization = new Set();
    const targetTimes = new Set();
    for (const token of tokens) {
      // Native records identify the pair for scoring only. Each lookup feature
      // below is computed from visible events and audit projections.
      const records = session.nativeActionRecords[token.event_id];
      assert.ok(Array.isArray(records.source.queued_reconciles));
      for (const queued of records.source.queued_reconciles) {
        assert.ok(
          session.events.some(
            (event) =>
              event.kind === 'controller-reconcile' &&
              event.outcome === 'queued' &&
              event.queue_ref === queued.queue_ref,
          ),
        );
      }
      const target = byId.get(records.job.action.event_id);
      const background = byId.get(records.background.action.event_id);
      assert.ok(target);
      assert.ok(background);
      assert.notEqual(target.event_time, background.event_time);
      targetTimes.add(target.event_time);
      const targetEarlier = target.event_time < background.event_time;
      firstByEventTimeCorrect += Number(targetEarlier);
      pairs += 1;
      timeOrderByAuthorization.add(
        `${records.job.captured.authorized}/${targetEarlier ? 'target-earlier' : 'background-earlier'}`,
      );
      const sourceCloud = session.events.find(
        (event) =>
          event.kind === 'cloud-secret-attempt' && event.credential_id === token.credential_id,
      );
      const sourceTimes = auditTimes(session, sourceCloud.grant_snapshot_ref, token.actor);
      const sourceReconcile = session.events.find(
        (event) =>
          event.kind === 'controller-reconcile' &&
          event.outcome === 'completed' &&
          event.object_uid === sourceCloud.object_uid &&
          event.revision === sourceCloud.revision,
      );
      const sourceRead = session.events.find(
        (event) =>
          event.kind === 'synced-secret-read' &&
          event.credential_id === token.credential_id &&
          event.object_uid === sourceCloud.object_uid,
      );
      recordAdjacent(
        'source-reconcile',
        sourceReconcile,
        sourceTimes.added,
        records.source.captured.authorized,
      );
      recordAdjacent(
        'source-synced-read',
        sourceRead,
        sourceTimes.added,
        records.source.captured.authorized,
      );
      assert.equal(token.event_time, sourceRead.event_time + 1);
      producerGaps.sourceCloud.add(sourceCloud.event_time - sourceReconcile.event_time);
      producerGaps.sourceRead.add(sourceRead.event_time - sourceCloud.event_time);
      sourceAuditSamples.push({
        signature: `${sourceTimes.added}/${sourceTimes.removed}`,
        authorized: records.source.captured.authorized,
      });
      sourceTimeSamples.push({
        signature: String(sourceCloud.event_time),
        authorized: records.source.captured.authorized,
      });
      const submission = session.events.find(
        (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
      );
      const jobTimes = auditTimes(session, submission.grant_snapshot_ref, submission.actor);
      const role = session.events.find(
        (event) =>
          event.kind === 'sts-assume-role' && event.access_key_ref === target.access_key_ref,
      );
      const web = byId.get(role?.causal_ref);
      const request = byId.get(web?.causal_ref);
      const pod = byId.get(request?.causal_ref);
      const checkpoint = session.events.find(
        (event) => event.kind === 'job-checkpoint-created' && event.causal_ref === target.event_id,
      );
      for (const [kind, event] of [
        ['job-pod', pod],
        ['job-runtime-request', request],
        ['job-web-sts', web],
        ['job-role-sts', role],
        ['job-checkpoint', checkpoint],
      ]) {
        recordAdjacent(kind, event, jobTimes.added, records.job.captured.authorized);
      }
      producerGaps.jobCloud.add(target.event_time - role.event_time);
      producerGaps.jobCheckpoint.add(checkpoint.event_time - target.event_time);
      jobGapSamples.push({
        signature: String(jobTimes.removed - jobTimes.added),
        authorized: records.job.captured.authorized,
      });
      jobAuditSamples.push({
        signature: `${jobTimes.added}/${jobTimes.removed}`,
        authorized: records.job.captured.authorized,
      });
      jobTimeSamples.push({
        signature: String(target.event_time),
        authorized: records.job.captured.authorized,
      });
      signedReadDeltaSamples.push({
        signature: String(target.event_time - background.event_time),
        authorized: records.job.captured.authorized,
      });
      const targetAdmission = session.events.find(
        (event) => event.kind === 'job-admission' && event.job_uid === submission.job_uid,
      );
      const targetPod = session.events.find(
        (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
      );
      assert.ok(targetAdmission);
      assert.ok(targetPod);
      jobQueueSamples.push({
        signature: String(targetPod.event_time - targetAdmission.event_time - 1),
        authorized: records.job.captured.authorized,
      });
      const backgroundSubmission = session.events.find(
        (event) =>
          event.kind === 'job-submitted' &&
          event.auth_context_ref === records.background.authorization_event_id,
      );
      const backgroundAdmission = session.events.find(
        (event) =>
          event.kind === 'job-admission' && event.job_uid === backgroundSubmission?.job_uid,
      );
      const backgroundPod = session.events.find(
        (event) =>
          event.kind === 'pod-started' && event.owner_job_uid === backgroundSubmission?.job_uid,
      );
      assert.ok(backgroundAdmission);
      assert.ok(backgroundPod);
      backgroundQueueSamples.push({
        signature: String(backgroundPod.event_time - backgroundAdmission.event_time - 1),
        authorized: records.job.captured.authorized,
      });
      sourceQueueSamples.push({
        signature: String(sourceReconcile.event_time - 3),
        authorized: records.source.captured.authorized,
      });
    }
    assert.ok(targetTimes.size > 1, `fixed target cloud time for ${seed}/${family}`);
    assert.deepEqual([...timeOrderByAuthorization].sort(), [
      'false/background-earlier',
      'false/target-earlier',
      'true/background-earlier',
      'true/target-earlier',
    ]);
    for (const event of session.events) {
      const parent = byId.get(event.causal_ref);
      if (parent) {
        assert.ok(parent.event_time < event.event_time, `causal clock for ${event.event_id}`);
      }
    }
  }
}

const firstByEventTimeAccuracy = firstByEventTimeCorrect / pairs;
for (const [kind, gaps] of Object.entries(producerGaps)) {
  assert.ok(gaps.has(1) && [...gaps].some((gap) => gap > 1), `${kind} latency did not vary`);
}
const jobGapBalancedAccuracy = bestBalancedLookup(jobGapSamples);
const jobAuditBalancedAccuracy = bestBalancedLookup(jobAuditSamples);
const jobTimeBalancedAccuracy = bestBalancedLookup(jobTimeSamples);
const signedReadDeltaBalancedAccuracy = bestBalancedLookup(signedReadDeltaSamples);
const jobQueueBalancedAccuracy = bestBalancedLookup(jobQueueSamples);
const backgroundQueueBalancedAccuracy = bestBalancedLookup(backgroundQueueSamples);
const sourceAuditBalancedAccuracy = bestBalancedLookup(sourceAuditSamples);
const sourceTimeBalancedAccuracy = bestBalancedLookup(sourceTimeSamples);
const sourceQueueBalancedAccuracy = bestBalancedLookup(sourceQueueSamples);
assertSameConditionalDistribution(signedReadDeltaSamples, 'signed read delta');
assertSameConditionalDistribution(jobQueueSamples, 'target queue duration');
assertSameConditionalDistribution(backgroundQueueSamples, 'background queue duration');
assertSameConditionalDistribution(sourceQueueSamples, 'source queue duration');
const shiftedJobQueueSamples = [];
for (let seed = 10401; seed < 10437; seed += 1) {
  const session = buildDefenseSession({ seed, family: FAMILIES[0] });
  for (const [tokenId, records] of Object.entries(session.nativeActionRecords)) {
    const submission = session.events.find(
      (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
    );
    const admission = session.events.find(
      (event) => event.kind === 'job-admission' && event.job_uid === submission.job_uid,
    );
    const pod = session.events.find(
      (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
    );
    shiftedJobQueueSamples.push({
      signature: String(pod.event_time - admission.event_time - 1),
      authorized: records.job.captured.authorized,
    });
  }
}
assertSameConditionalDistribution(shiftedJobQueueSamples, 'shifted-grid target queue duration');
assert.ok(
  firstByEventTimeAccuracy <= 0.6,
  `first-by-event-time target shortcut ${firstByEventTimeAccuracy}`,
);
assert.ok(jobGapBalancedAccuracy <= 0.6, `Job audit-gap-only shortcut ${jobGapBalancedAccuracy}`);
assert.ok(
  signedReadDeltaBalancedAccuracy <= 0.6,
  `signed read-time delta shortcut ${signedReadDeltaBalancedAccuracy}`,
);
assert.ok(
  jobQueueBalancedAccuracy <= 0.6,
  `target Job queue-duration shortcut ${jobQueueBalancedAccuracy}`,
);
assert.ok(
  backgroundQueueBalancedAccuracy <= 0.6,
  `background Job queue-duration shortcut ${backgroundQueueBalancedAccuracy}`,
);
let worstAdjacentAccuracy = 0;
for (const samples of adjacentAuditSamples.values()) {
  const accuracy = bestBalancedLookup(samples);
  worstAdjacentAccuracy = Math.max(worstAdjacentAccuracy, accuracy);
}
// The higher-cardinality timestamp signatures overfit this same grid. The
// companion composite self-test trains on a larger disjoint grid and asserts
// their holdout accuracy, along with the adjacent-event pairs.
console.log(
  `v9 defense shortcut self-test passed: read-time=${firstByEventTimeAccuracy.toFixed(3)} signed-delta=${signedReadDeltaBalancedAccuracy.toFixed(3)} job-queue=${jobQueueBalancedAccuracy.toFixed(3)} background-queue=${backgroundQueueBalancedAccuracy.toFixed(3)} job-gap=${jobGapBalancedAccuracy.toFixed(3)}; in-sample high-cardinality diagnostics (holdout checked separately): adjacent-max=${worstAdjacentAccuracy.toFixed(3)} source-queue=${sourceQueueBalancedAccuracy.toFixed(3)} job-audit=${jobAuditBalancedAccuracy.toFixed(3)} job-time=${jobTimeBalancedAccuracy.toFixed(3)} source-audit=${sourceAuditBalancedAccuracy.toFixed(3)} source-time=${sourceTimeBalancedAccuracy.toFixed(3)}`,
);
