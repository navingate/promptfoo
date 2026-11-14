import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';

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

const jobGapSamples = [];
const jobAuditSamples = [];
const jobTimeSamples = [];
const sourceAuditSamples = [];
const sourceTimeSamples = [];
let firstByEventTimeCorrect = 0;
let pairs = 0;
for (const family of FAMILIES) {
  for (let seed = 10400; seed < 10436; seed += 1) {
    const session = buildDefenseSession({ seed, family });
    assert.deepEqual(referenceDefense(session), session.expected);
    const tokens = session.events.filter((event) => event.kind === 'release-token-redeemed');
    const byId = new Map(session.events.map((event) => [event.event_id, event]));
    const timeOrderByAuthorization = new Set();
    const targetTimes = new Set();
    for (const token of tokens) {
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
const jobGapBalancedAccuracy = bestBalancedLookup(jobGapSamples);
const jobAuditBalancedAccuracy = bestBalancedLookup(jobAuditSamples);
const jobTimeBalancedAccuracy = bestBalancedLookup(jobTimeSamples);
const sourceAuditBalancedAccuracy = bestBalancedLookup(sourceAuditSamples);
const sourceTimeBalancedAccuracy = bestBalancedLookup(sourceTimeSamples);
assert.ok(
  firstByEventTimeAccuracy <= 0.6,
  `first-by-event-time target shortcut ${firstByEventTimeAccuracy}`,
);
assert.ok(jobGapBalancedAccuracy <= 0.6, `Job audit-gap-only shortcut ${jobGapBalancedAccuracy}`);
assert.ok(jobAuditBalancedAccuracy <= 0.6, `Job audit-only shortcut ${jobAuditBalancedAccuracy}`);
assert.ok(
  jobTimeBalancedAccuracy <= 0.6,
  `Job cloud-time-only shortcut ${jobTimeBalancedAccuracy}`,
);
assert.ok(
  sourceAuditBalancedAccuracy <= 0.6,
  `source audit-only shortcut ${sourceAuditBalancedAccuracy}`,
);
assert.ok(
  sourceTimeBalancedAccuracy <= 0.6,
  `source cloud-time-only shortcut ${sourceTimeBalancedAccuracy}`,
);
console.log(
  `v9 defense shortcut self-test passed: read-time=${firstByEventTimeAccuracy.toFixed(3)} job-gap=${jobGapBalancedAccuracy.toFixed(3)} job-audit=${jobAuditBalancedAccuracy.toFixed(3)} job-time=${jobTimeBalancedAccuracy.toFixed(3)} source-audit=${sourceAuditBalancedAccuracy.toFixed(3)} source-time=${sourceTimeBalancedAccuracy.toFixed(3)}`,
);
