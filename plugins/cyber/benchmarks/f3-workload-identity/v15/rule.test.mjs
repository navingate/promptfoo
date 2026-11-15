import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession } from '../v9/defense.mjs';
import {
  executeRuleFullChainV2,
  REFERENCE_RULE_V2,
  validateRule,
  validateRuleV2,
} from '../v10/rule.mjs';

const SPEC = {
  seed: 22901,
  family: 'reconcile-hook',
  sourceAmbiguity: true,
  sourceRevisionRace: true,
  linkAmbiguity: true,
  operationalCheckpoint: true,
  jobRenewal: true,
};

function scopedEvidence() {
  const world = buildDefenseSession(SPEC);
  const evidence = {
    events: structuredClone(world.events),
    grantSnapshots: structuredClone(world.grantSnapshots),
    membershipAudit: structuredClone(world.membershipAudit),
    policySnapshots: structuredClone(world.policySnapshots),
  };
  for (const snapshot of evidence.grantSnapshots) {
    const source = evidence.events.find(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.grant_snapshot_ref === snapshot.snapshot_ref &&
        event.outcome === 'completed',
    );
    const job = evidence.events.find(
      (event) =>
        event.kind === 'job-submitted' && event.grant_snapshot_ref === snapshot.snapshot_ref,
    );
    const scope = source
      ? { controller_id: source.controller_id, valid_from: 0, valid_until: 1_000_000 }
      : job
        ? {
            service_account_id: job.service_account_id,
            template_id: job.template_id,
            valid_from: 0,
            valid_until: 1_000_000,
          }
        : null;
    if (scope) {
      for (const grant of snapshot.grants) {
        grant.scope = { ...scope };
      }
    }
  }
  return { evidence, world };
}

test('v2 rule requires exactly the scoped workload paths while v1 stays valid', () => {
  assert.equal(validateRule(REFERENCE_RULE_V2).ok, false);
  assert.equal(validateRuleV2(REFERENCE_RULE_V2).ok, true);
  const missing = structuredClone(REFERENCE_RULE_V2);
  delete missing.authorization.job.template;
  assert.equal(validateRuleV2(missing).ok, false);
  const unsafe = structuredClone(REFERENCE_RULE_V2);
  unsafe.authorization.source.controller = 'sourceCloud.__proto__';
  assert.equal(validateRuleV2(unsafe).ok, false);
});

test('v2 reference preserves labels when source and Job approval scopes cover every action', () => {
  const { evidence, world } = scopedEvidence();
  const result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.labels, world.expected);
});

test('v2 checks Job identity binding and half-open validity at the cloud read', () => {
  const { evidence, world } = scopedEvidence();
  const tokenId = Object.keys(world.expected).find(
    (id) => world.expected[id] === 'approved-automation',
  );
  const submitted = evidence.events.find(
    (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
  );
  const snapshot = evidence.grantSnapshots.find(
    (item) => item.snapshot_ref === submitted.grant_snapshot_ref,
  );
  for (const grant of snapshot.grants) {
    grant.scope.service_account_id = 'sa-other';
  }
  let result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.equal(result.labels[tokenId], 'job-cascade');

  for (const grant of snapshot.grants) {
    grant.scope.service_account_id = submitted.service_account_id;
  }
  const jobRead = evidence.events.find(
    (event) => event.event_id === result.proofs[tokenId].job_read_event_id,
  );
  assert.ok(jobRead);
  for (const grant of snapshot.grants) {
    grant.scope.valid_until = jobRead.event_time;
  }
  result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.equal(result.labels[tokenId], 'job-cascade');
});

test('v2 checks source controller scope and attributes the fetch to the causal writer', () => {
  const { evidence, world } = scopedEvidence();
  const tokenId = Object.keys(world.expected).find(
    (id) => world.expected[id] === 'approved-automation',
  );
  const initial = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  const sourceCloud = evidence.events.find(
    (event) => event.event_id === initial.proofs[tokenId].source_read_event_id,
  );
  const snapshot = evidence.grantSnapshots.find(
    (item) => item.snapshot_ref === sourceCloud.grant_snapshot_ref,
  );
  for (const grant of snapshot.grants) {
    grant.scope.controller_id = 'controller-other';
  }
  let result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.equal(result.labels[tokenId], 'source-cascade');

  for (const grant of snapshot.grants) {
    grant.scope.controller_id = sourceCloud.controller_id;
  }
  const sourceWrite = evidence.events.find(
    (event) =>
      event.kind === 'object-spec-write' &&
      event.object_uid === sourceCloud.object_uid &&
      event.revision === sourceCloud.revision &&
      ['create', 'patch'].includes(event.verb),
  );
  const otherWriter = snapshot.grants.find(
    (grant) =>
      grant.task.action === sourceCloud.action &&
      grant.task.remote_ref === sourceCloud.resource &&
      grant.writer_principal !== sourceWrite.actor &&
      !grant.writer_principal.startsWith('group:'),
  );
  assert.ok(otherWriter);
  sourceWrite.actor = otherWriter.writer_principal;
  result = executeRuleFullChainV2(evidence, REFERENCE_RULE_V2);
  assert.equal(result.labels[tokenId], 'approved-automation');
});
