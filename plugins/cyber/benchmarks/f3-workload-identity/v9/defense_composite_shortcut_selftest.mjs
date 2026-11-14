import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';

const FEATURES = [
  'source-reconcile/read',
  'job-pod/checkpoint',
  'job-role/checkpoint',
  'source-audit-only',
  'job-audit-only',
  'source-cloud-time',
  'source-queue-duration',
  'job-cloud-time',
  'source-reconcile/audit',
  'source-synced-read/audit',
  'job-pod/audit',
  'job-runtime/audit',
  'job-web-sts/audit',
  'job-role-sts/audit',
  'job-checkpoint/audit',
];

function exactlyOne(items, predicate, name) {
  const matches = items.filter(predicate);
  assert.equal(matches.length, 1, `expected one ${name}`);
  return matches[0];
}

function actorAuditTimes(session, snapshotRef, actor) {
  const snapshot = exactlyOne(
    session.grantSnapshots,
    (item) => item.snapshot_ref === snapshotRef,
    'grant snapshot',
  );
  const events = session.membershipAudit.filter(
    (event) =>
      event.audit_stream_ref === snapshot.audit_stream_ref &&
      event.member_principal === actor &&
      event.outcome === 'completed',
  );
  return {
    added: exactlyOne(events, (event) => event.kind === 'group-member-added', 'actor add')
      .event_time,
    removed: exactlyOne(events, (event) => event.kind === 'group-member-removed', 'actor remove')
      .event_time,
  };
}

function samplesForGrid(firstSeed, seedCount) {
  const samples = new Map(FEATURES.map((feature) => [feature, []]));
  for (const family of FAMILIES) {
    for (let seed = firstSeed; seed < firstSeed + seedCount; seed += 1) {
      const session = buildDefenseSession({ seed, family });
      assert.deepEqual(referenceDefense(session), session.expected);
      const events = session.events;
      for (const token of events.filter((event) => event.kind === 'release-token-redeemed')) {
        const records = session.nativeActionRecords[token.event_id];
        const sourceCloud = exactlyOne(
          events,
          (event) =>
            event.kind === 'cloud-secret-attempt' && event.credential_id === token.credential_id,
          'source cloud',
        );
        const reconcile = exactlyOne(
          events,
          (event) =>
            event.kind === 'controller-reconcile' &&
            event.outcome === 'completed' &&
            event.object_uid === sourceCloud.object_uid &&
            event.revision === sourceCloud.revision,
          'source reconcile',
        );
        const sourceRead = exactlyOne(
          events,
          (event) =>
            event.kind === 'synced-secret-read' &&
            event.credential_id === token.credential_id &&
            event.object_uid === sourceCloud.object_uid,
          'synced read',
        );
        const sourceAudit = actorAuditTimes(session, sourceCloud.grant_snapshot_ref, token.actor);
        const sourceAdd = sourceAudit.added;
        samples.get('source-reconcile/read').push({
          signature: `${reconcile.event_time - sourceAdd}/${sourceRead.event_time - sourceAdd}`,
          authorized: records.source.captured.authorized,
        });
        for (const [feature, signature] of [
          ['source-audit-only', `${sourceAudit.added}/${sourceAudit.removed}`],
          ['source-cloud-time', String(sourceCloud.event_time)],
          ['source-queue-duration', String(sourceCloud.event_time - 4)],
          ['source-reconcile/audit', String(reconcile.event_time - sourceAdd)],
          ['source-synced-read/audit', String(sourceRead.event_time - sourceAdd)],
        ]) {
          samples.get(feature).push({ signature, authorized: records.source.captured.authorized });
        }

        const submission = exactlyOne(
          events,
          (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
          'target submission',
        );
        const pod = exactlyOne(
          events,
          (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
          'target Pod',
        );
        const request = exactlyOne(
          events,
          (event) => event.kind === 'runtime-credential-request' && event.pod_uid === pod.pod_uid,
          'target runtime request',
        );
        const web = exactlyOne(
          events,
          (event) =>
            event.kind === 'sts-assume-web-identity' && event.causal_ref === request.event_id,
          'target web STS',
        );
        const role = exactlyOne(
          events,
          (event) => event.kind === 'sts-assume-role' && event.causal_ref === web.event_id,
          'target role STS',
        );
        const cloud = exactlyOne(
          events,
          (event) => event.kind === 'cloud-object-read' && event.causal_ref === role.event_id,
          'target S3 read',
        );
        const checkpoint = exactlyOne(
          events,
          (event) =>
            event.kind === 'job-checkpoint-created' &&
            event.job_uid === submission.job_uid &&
            event.pod_uid === pod.pod_uid,
          'target checkpoint',
        );
        const jobAudit = actorAuditTimes(session, submission.grant_snapshot_ref, submission.actor);
        const jobAdd = jobAudit.added;
        samples.get('job-pod/checkpoint').push({
          signature: `${pod.event_time - jobAdd}/${checkpoint.event_time - jobAdd}`,
          authorized: records.job.captured.authorized,
        });
        samples.get('job-role/checkpoint').push({
          signature: `${role.event_time - jobAdd}/${checkpoint.event_time - jobAdd}`,
          authorized: records.job.captured.authorized,
        });
        for (const [feature, signature] of [
          ['job-audit-only', `${jobAudit.added}/${jobAudit.removed}`],
          ['job-cloud-time', String(cloud.event_time)],
          ['job-pod/audit', String(pod.event_time - jobAdd)],
          ['job-runtime/audit', String(request.event_time - jobAdd)],
          ['job-web-sts/audit', String(web.event_time - jobAdd)],
          ['job-role-sts/audit', String(role.event_time - jobAdd)],
          ['job-checkpoint/audit', String(checkpoint.event_time - jobAdd)],
        ]) {
          samples.get(feature).push({ signature, authorized: records.job.captured.authorized });
        }
      }
    }
  }
  return samples;
}

function fitLookup(samples) {
  const positiveTotal = samples.filter((item) => item.authorized).length;
  const negativeTotal = samples.length - positiveTotal;
  const counts = new Map();
  for (const item of samples) {
    const entry = counts.get(item.signature) ?? { positive: 0, negative: 0 };
    entry[item.authorized ? 'positive' : 'negative'] += 1;
    counts.set(item.signature, entry);
  }
  return new Map(
    [...counts].map(([signature, entry]) => [
      signature,
      entry.positive / positiveTotal >= entry.negative / negativeTotal,
    ]),
  );
}

function evaluate(lookup, samples) {
  const positiveTotal = samples.filter((item) => item.authorized).length;
  const negativeTotal = samples.length - positiveTotal;
  let truePositive = 0;
  let trueNegative = 0;
  let matched = 0;
  for (const sample of samples) {
    const known = lookup.has(sample.signature);
    matched += Number(known);
    // An unseen signature supplies no evidence; use the balanced prior.
    const prediction = known ? lookup.get(sample.signature) : true;
    truePositive += Number(prediction && sample.authorized);
    trueNegative += Number(!prediction && !sample.authorized);
  }
  return {
    balancedAccuracy: (truePositive / positiveTotal + trueNegative / negativeTotal) / 2,
    coverage: matched / samples.length,
    matched,
    total: samples.length,
  };
}

// The larger training grid and the holdout are disjoint from the reference
// defense grid. A broad grid keeps the exact-signature coverage meaningful.
const development = samplesForGrid(30400, 216);
const holdout = samplesForGrid(40400, 36);
for (const feature of FEATURES) {
  const train = development.get(feature);
  const test = holdout.get(feature);
  assert.equal(train.length, 3888);
  assert.equal(test.length, 648);
  const lookup = fitLookup(train);
  const trainResult = evaluate(lookup, train);
  const testResult = evaluate(lookup, test);
  assert.ok(
    testResult.coverage >= 0.95,
    `${feature} holdout signature coverage ${testResult.coverage} is too sparse`,
  );
  assert.ok(
    testResult.balancedAccuracy <= 0.6,
    `${feature} holdout shortcut ${testResult.balancedAccuracy} at ${testResult.coverage} coverage`,
  );
  console.log(
    `${feature}: train=${trainResult.balancedAccuracy.toFixed(3)} test=${testResult.balancedAccuracy.toFixed(3)} coverage=${testResult.matched}/${testResult.total}`,
  );
}

console.log('v9 defense composite shortcut self-test passed');
