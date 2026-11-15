import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession } from '../v9/defense.mjs';
import {
  executeRuleFullChainV2,
  executeRulePerReadV2,
  REFERENCE_RULE_PER_READ_V2,
  REFERENCE_RULE_V2,
  readDecisionKey,
  validateRuleV2,
} from '../v10/rule.mjs';

const SPEC = {
  seed: 34001,
  family: 'reconcile-hook',
  sourceAmbiguity: true,
  sourceRevisionRace: true,
  linkAmbiguity: true,
  operationalCheckpoint: true,
  jobRenewal: true,
  approvalContext: true,
  perReadApproval: true,
};

function evidenceFor(spec = SPEC) {
  const world = buildDefenseSession(spec);
  return {
    world,
    evidence: {
      events: structuredClone(world.events),
      grantSnapshots: structuredClone(world.grantSnapshots),
      membershipAudit: structuredClone(world.membershipAudit),
      policySnapshots: structuredClone(world.policySnapshots),
    },
  };
}

test('v16 reference keeps v2 grammar and makes a distinct decision for both completed Job reads', () => {
  const { world, evidence } = evidenceFor();
  assert.equal(validateRuleV2(REFERENCE_RULE_PER_READ_V2).ok, true);
  const result = executeRulePerReadV2(evidence, REFERENCE_RULE_PER_READ_V2);
  assert.deepEqual(result.errors, {});
  assert.equal(Object.keys(result.sourceAlerts).length, 6);
  assert.equal(Object.keys(result.jobAlerts).length, 12);
  assert.equal(Object.keys(result.proofs).length, 12);
  for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
    assert.equal(result.sourceAlerts[tokenId], !record.source.captured.authorized);
    for (const read of record.job.reads) {
      const key = readDecisionKey(tokenId, read.action.event_id);
      assert.equal(result.jobAlerts[key], !read.captured.authorized);
      assert.deepEqual(result.proofs[key], {
        source_read_event_id: record.source.action.event_id,
        job_read_event_id: read.action.event_id,
        checkpoint_event_id: read.checkpoint_event_id,
      });
    }
  }
});

test('v15 target-only rule is still valid but omits every operational read under v16 scoring', () => {
  const { evidence } = evidenceFor();
  const targetOnly = executeRulePerReadV2(evidence, REFERENCE_RULE_V2);
  assert.equal(Object.keys(targetOnly.jobAlerts).length, 6);
  const perRead = executeRulePerReadV2(evidence, REFERENCE_RULE_PER_READ_V2);
  assert.equal(Object.keys(perRead.jobAlerts).length, 12);
});

test('the v16 rule detects an operational-only approval miss in a successful Job session', () => {
  const { world, evidence } = evidenceFor();
  const result = executeRulePerReadV2(evidence, REFERENCE_RULE_PER_READ_V2);
  const candidate = Object.entries(world.nativeActionRecords).find(([, record]) => {
    const target = record.job.reads.find((read) => read.role === 'target');
    const operational = record.job.reads.find((read) => read.role === 'operational');
    return (
      record.source.captured.authorized &&
      target.captured.authorized &&
      !operational.captured.authorized
    );
  });
  assert.ok(candidate, 'the batch must include an operational-only approval miss');
  const [tokenId, record] = candidate;
  const target = record.job.reads.find((read) => read.role === 'target');
  const operational = record.job.reads.find((read) => read.role === 'operational');
  assert.equal(result.sourceAlerts[tokenId], false);
  assert.equal(result.jobAlerts[readDecisionKey(tokenId, target.action.event_id)], false);
  assert.equal(result.jobAlerts[readDecisionKey(tokenId, operational.action.event_id)], true);
});

test('v16 interpreter does not change the v15 single-target executor', () => {
  const { evidence } = evidenceFor({ ...SPEC, perReadApproval: false });
  const result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.deepEqual(result.errors, {});
  assert.equal(Object.keys(result.labels).length, 6);
});
