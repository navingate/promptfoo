import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession } from '../v9/defense.mjs';
import * as rules from '../v10/rule.mjs';

const SPEC = {
  seed: 35101,
  family: 'reconcile-hook',
  sourceAmbiguity: true,
  sourceRevisionRace: true,
  linkAmbiguity: true,
  operationalCheckpoint: true,
  jobRenewal: true,
  approvalContext: true,
  perReadApproval: true,
};

function evidenceFor() {
  const world = buildDefenseSession(SPEC);
  const evidence = {
    events: structuredClone(world.events),
    grantSnapshots: structuredClone(world.grantSnapshots),
    membershipAudit: structuredClone(world.membershipAudit),
    policySnapshots: structuredClone(world.policySnapshots),
    approvalPublications: [],
  };
  for (const admission of evidence.events.filter(
    (event) => event.kind === 'job-admission' && event.outcome === 'admitted',
  )) {
    const submission = evidence.events.find((event) => event.event_id === admission.causal_ref);
    const snapshot = evidence.grantSnapshots.find(
      (item) => item.snapshot_ref === submission?.grant_snapshot_ref,
    );
    if (!snapshot) {
      continue;
    }
    admission.approval_stream_ref = `approval:${admission.job_uid}`;
    snapshot.approval_stream_ref = admission.approval_stream_ref;
    const ownerSnapshot = structuredClone(snapshot);
    ownerSnapshot.snapshot_ref = `${snapshot.snapshot_ref}:owner`;
    ownerSnapshot.approval_stream_ref = `owner-approval:${admission.job_uid}`;
    submission.owner_snapshot_ref = ownerSnapshot.snapshot_ref;
    admission.owner_approval_stream_ref = ownerSnapshot.approval_stream_ref;
    evidence.grantSnapshots.push(ownerSnapshot);
  }
  return { world, evidence };
}

function operationalFirstApprovedPair(world, evidence) {
  const entry = Object.entries(world.nativeActionRecords).find(([, record]) => {
    const target = record.job.reads.find((read) => read.role === 'target');
    const operational = record.job.reads.find((read) => read.role === 'operational');
    return (
      target.captured.authorized &&
      operational.captured.authorized &&
      operational.action.event_time + 1 < target.action.event_time
    );
  });
  assert.ok(entry, 'test needs a completed operational read before an approved target read');
  const [tokenId, record] = entry;
  const submission = evidence.events.find(
    (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
  );
  const admission = evidence.events.find(
    (event) =>
      event.kind === 'job-admission' &&
      event.outcome === 'admitted' &&
      event.job_uid === submission.job_uid,
  );
  const base = evidence.grantSnapshots.find(
    (item) => item.snapshot_ref === submission.grant_snapshot_ref,
  );
  const target = record.job.reads.find((read) => read.role === 'target');
  const operational = record.job.reads.find((read) => read.role === 'operational');
  assert.ok(admission && base);
  const ownerBase = evidence.grantSnapshots.find(
    (item) => item.snapshot_ref === submission.owner_snapshot_ref,
  );
  assert.ok(ownerBase);
  return { tokenId, record, admission, base, ownerBase, target, operational };
}

function revokeTargetBetweenReads(evidence, pair, lane = 'change') {
  const base = lane === 'owner' ? pair.ownerBase : pair.base;
  const stream =
    lane === 'owner'
      ? pair.admission.owner_approval_stream_ref
      : pair.admission.approval_stream_ref;
  const newSnapshot = {
    ...structuredClone(base),
    snapshot_ref: `${base.snapshot_ref}:revision-1`,
    grants: base.grants.filter((grant) => grant.task.remote_ref !== pair.target.action.resource),
  };
  evidence.grantSnapshots.push(newSnapshot);
  evidence.approvalPublications.push({
    event_id: `publication:${lane}:${pair.admission.job_uid}`,
    approval_stream_ref: stream,
    previous_snapshot_ref: base.snapshot_ref,
    new_snapshot_ref: newSnapshot.snapshot_ref,
    event_time: pair.operational.action.event_time + 1,
    arrival_order: 1001,
    outcome: 'completed',
  });
}

test('v3 validates the bounded latest-completed-revision selector and retains v2 scope fields', () => {
  assert.equal(rules.validateRuleV3(rules.REFERENCE_RULE_PER_READ_V3).ok, true);
  assert.deepEqual(rules.REFERENCE_RULE_PER_READ_V3.authorization.owner.snapshot, {
    mode: 'latest-completed-revision',
    base: 'submission.owner_snapshot_ref',
    stream: 'admission.owner_approval_stream_ref',
  });
  const missingServiceAccount = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  delete missingServiceAccount.authorization.job.serviceAccount;
  assert.equal(rules.validateRuleV3(missingServiceAccount).ok, false);
  const missingOwner = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  delete missingOwner.authorization.owner;
  assert.equal(rules.validateRuleV3(missingOwner).ok, false);
  const unsafe = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  unsafe.authorization.job.snapshot.stream = 'jobCloud.authorization_snapshot_ref';
  assert.equal(rules.validateRuleV3(unsafe).ok, false);
  const crossedLane = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  crossedLane.authorization.owner.snapshot = 'submission.grant_snapshot_ref';
  assert.equal(
    rules.validateRuleV3(crossedLane).ok,
    false,
    'owner lane cannot reuse the change-approval snapshot',
  );
});

test('v3 accepts observed role ARN joins while frozen v2 grammar stays unchanged', () => {
  const v3 = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  v3.joins.roleSts.push({ from: 'webSts', left: 'role_arn', right: 'actor' });
  v3.joins.jobCloud.push({ from: 'roleSts', left: 'role_arn', right: 'actor' });
  assert.equal(rules.validateRuleV3(v3).ok, true);
  const v2 = structuredClone(rules.REFERENCE_RULE_PER_READ_V2);
  v2.joins.roleSts.push({ from: 'webSts', left: 'role_arn', right: 'actor' });
  assert.equal(rules.validateRuleV2(v2).ok, false);
});

test('v3 reference reproduces v16 decisions when no approval has been revised', () => {
  const { world, evidence } = evidenceFor();
  const result = rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3);
  assert.deepEqual(result.errors, {});
  assert.equal(Object.keys(result.sourceAlerts).length, 6);
  assert.equal(Object.keys(result.jobAlerts).length, 12);
  for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
    assert.equal(result.sourceAlerts[tokenId], !record.source.captured.authorized);
    for (const read of record.job.reads) {
      const key = rules.readDecisionKey(tokenId, read.action.event_id);
      assert.equal(result.jobAlerts[key], !read.captured.authorized);
    }
  }
});

test('v3 uses the completed organizational revision between two reads of one Job', () => {
  const { world, evidence } = evidenceFor();
  const pair = operationalFirstApprovedPair(world, evidence);
  revokeTargetBetweenReads(evidence, pair);
  const dynamic = rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3);
  const staticRule = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  staticRule.authorization.job.snapshot = 'submission.grant_snapshot_ref';
  const staticallyBound = rules.executeRulePerReadV3(evidence, staticRule);
  const operationalKey = rules.readDecisionKey(pair.tokenId, pair.operational.action.event_id);
  const targetKey = rules.readDecisionKey(pair.tokenId, pair.target.action.event_id);
  assert.equal(dynamic.jobAlerts[operationalKey], false);
  assert.equal(dynamic.jobAlerts[targetKey], true);
  assert.equal(staticallyBound.jobAlerts[targetKey], false);
  assert.equal(dynamic.sourceAlerts[pair.tokenId], staticallyBound.sourceAlerts[pair.tokenId]);
});

test('v3 alerts when data-owner approval is revoked while change approval remains valid', () => {
  const { world, evidence } = evidenceFor();
  const pair = operationalFirstApprovedPair(world, evidence);
  revokeTargetBetweenReads(evidence, pair, 'owner');
  const dynamic = rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3);
  const staticOwnerRule = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  staticOwnerRule.authorization.owner.snapshot = 'submission.owner_snapshot_ref';
  const staticOwner = rules.executeRulePerReadV3(evidence, staticOwnerRule);
  const operationalKey = rules.readDecisionKey(pair.tokenId, pair.operational.action.event_id);
  const targetKey = rules.readDecisionKey(pair.tokenId, pair.target.action.event_id);
  assert.equal(dynamic.jobAlerts[operationalKey], false);
  assert.equal(dynamic.jobAlerts[targetKey], true);
  assert.equal(staticOwner.jobAlerts[targetKey], false);
});

test('v3 ignores denied and same-time owner revisions for the current read', () => {
  const { world, evidence } = evidenceFor();
  const pair = operationalFirstApprovedPair(world, evidence);
  revokeTargetBetweenReads(evidence, pair, 'owner');
  const targetKey = rules.readDecisionKey(pair.tokenId, pair.target.action.event_id);
  evidence.approvalPublications[0].outcome = 'denied';
  assert.equal(
    rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3).jobAlerts[targetKey],
    false,
  );
  evidence.approvalPublications[0].outcome = 'completed';
  evidence.approvalPublications[0].event_time = pair.target.action.event_time;
  assert.equal(
    rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3).jobAlerts[targetKey],
    false,
  );
});

test('v3 rejects duplicate publication event IDs even when the duplicate is on another stream', () => {
  const { world, evidence } = evidenceFor();
  const pair = operationalFirstApprovedPair(world, evidence);
  revokeTargetBetweenReads(evidence, pair);
  evidence.approvalPublications.push({
    ...evidence.approvalPublications[0],
    approval_stream_ref: 'unrelated-approval-stream',
  });
  const result = rules.executeRulePerReadV3(evidence, rules.REFERENCE_RULE_PER_READ_V3);
  assert.ok(result.errors._evidence?.length, 'duplicate native event IDs must invalidate evidence');
});

test('v3 static owner baseline fails closed if the snapshot belongs to the change stream', () => {
  const { world, evidence } = evidenceFor();
  const pair = operationalFirstApprovedPair(world, evidence);
  pair.ownerBase.approval_stream_ref = pair.admission.approval_stream_ref;
  const staticOwnerRule = structuredClone(rules.REFERENCE_RULE_PER_READ_V3);
  staticOwnerRule.authorization.owner.snapshot = 'submission.owner_snapshot_ref';
  const result = rules.executeRulePerReadV3(evidence, staticOwnerRule);
  const targetKey = rules.readDecisionKey(pair.tokenId, pair.target.action.event_id);
  assert.equal(result.jobAlerts[targetKey], null);
  assert.ok(result.errors[targetKey]?.some((error) => error.startsWith('authorization:')));
});
