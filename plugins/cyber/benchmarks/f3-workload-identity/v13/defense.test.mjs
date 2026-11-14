import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession as buildNativeWorld } from '../v9/defense.mjs';
import { executeRule, executeRuleFullChain, REFERENCE_RULE } from '../v10/rule.mjs';
import {
  buildDefenseSession as buildCombinedSession,
  referenceDefense as combinedReference,
  scoreDefense as scoreCombined,
  stepDefense as stepCombined,
} from './defense.mjs';

function visible(world) {
  return {
    events: structuredClone(world.events),
    grantSnapshots: structuredClone(world.grantSnapshots),
    membershipAudit: structuredClone(world.membershipAudit),
    policySnapshots: structuredClone(world.policySnapshots),
  };
}

test('a complete path resolves a legitimate second credential chain', () => {
  const world = buildNativeWorld({ seed: 22801, family: 'reconcile-hook', linkAmbiguity: true });
  const evidence = visible(world);
  const tokenId = Object.keys(world.nativeActionRecords)[0];
  const targetId = world.nativeActionRecords[tokenId].job.action.event_id;
  const read = evidence.events.find((event) => event.event_id === targetId);
  const role = evidence.events.find((event) => event.event_id === read.causal_ref);
  const web = evidence.events.find((event) => event.event_id === role.causal_ref);
  const request = evidence.events.find((event) => event.event_id === web.causal_ref);
  assert.ok(request && web && role && read);

  // Make room between the old role and read in the arrival ordering without
  // changing authorization event_time or membership evidence.
  for (const event of evidence.events) {
    event.arrival_order *= 100;
  }
  const renewedRequest = {
    ...request,
    event_id: `${request.event_id}-renewed`,
    role_session_name: `${request.role_session_name}-renewed`,
    arrival_order: role.arrival_order + 1,
  };
  const renewedWeb = {
    ...web,
    event_id: `${web.event_id}-renewed`,
    role_session_name: renewedRequest.role_session_name,
    access_key_ref: `${web.access_key_ref}-renewed`,
    causal_ref: renewedRequest.event_id,
    arrival_order: role.arrival_order + 2,
  };
  const renewedRole = {
    ...role,
    event_id: `${role.event_id}-renewed`,
    source_access_key_ref: renewedWeb.access_key_ref,
    access_key_ref: `${role.access_key_ref}-renewed`,
    causal_ref: renewedWeb.event_id,
    arrival_order: role.arrival_order + 3,
  };
  read.causal_ref = renewedRole.event_id;
  read.access_key_ref = renewedRole.access_key_ref;
  evidence.events.push(renewedRequest, renewedWeb, renewedRole);

  const greedy = executeRule(evidence, REFERENCE_RULE);
  assert.equal(greedy.labels[tokenId], null);
  assert.deepEqual(greedy.errors[tokenId], ['request:ambiguous']);

  const complete = executeRuleFullChain(evidence, REFERENCE_RULE);
  assert.equal(complete.labels[tokenId], world.expected[tokenId]);
  assert.equal(complete.proofs[tokenId].job_read_event_id, targetId);
  assert.equal(
    complete.proofs[tokenId].source_read_event_id,
    world.nativeActionRecords[tokenId].source.action.event_id,
  );
});

test('conflicting completed proof tuples remain ambiguous', () => {
  const world = buildNativeWorld({ seed: 22801, family: 'reconcile-hook', linkAmbiguity: true });
  const evidence = visible(world);
  const tokenId = Object.keys(world.nativeActionRecords)[0];
  const targetId = world.nativeActionRecords[tokenId].job.action.event_id;
  const read = evidence.events.find((event) => event.event_id === targetId);
  const checkpoint = evidence.events.find((event) => event.cloud_read_event_id === targetId);
  assert.ok(read && checkpoint);
  evidence.events.push({ ...read, event_id: `${read.event_id}-duplicate` });
  evidence.events.push({
    ...checkpoint,
    event_id: `${checkpoint.event_id}-duplicate`,
    cloud_read_event_id: `${read.event_id}-duplicate`,
    causal_ref: `${read.event_id}-duplicate`,
  });
  const result = executeRuleFullChain(evidence, REFERENCE_RULE);
  assert.equal(result.labels[tokenId], null);
  assert.deepEqual(result.errors[tokenId], ['path:ambiguous']);
});

test('a weak join cannot exhaust whole-path enumeration', () => {
  const world = buildNativeWorld({ seed: 22801, family: 'reconcile-hook' });
  const evidence = visible(world);
  const tokenId = Object.keys(world.nativeActionRecords)[0];
  const sourceId = world.nativeActionRecords[tokenId].source.action.event_id;
  const source = evidence.events.find((event) => event.event_id === sourceId);
  assert.ok(source);
  for (let index = 0; index < 4097; index += 1) {
    evidence.events.push({ ...source, event_id: `${source.event_id}-copy-${index}` });
  }
  const result = executeRuleFullChain(evidence, REFERENCE_RULE);
  assert.equal(result.labels[tokenId], null);
  assert.deepEqual(result.errors[tokenId], ['path:limit']);
});

test('combined native source paths bind a completed fetch to the redeemed revision', () => {
  const world = buildNativeWorld({
    seed: 22801,
    family: 'reconcile-hook',
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
  });
  for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
    const token = world.events.find((event) => event.event_id === tokenId);
    const selected = world.events.find((event) => event.event_id === record.source.action.event_id);
    const candidates = world.events.filter(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.outcome === 'completed' &&
        event.credential_id === token.credential_id &&
        event.object_name?.startsWith('es-'),
    );
    const sameMapping = candidates.filter((event) => event.resource === token.credential_ref);
    const otherMapping = candidates.filter((event) => event.resource !== token.credential_ref);
    assert.equal(candidates.length, 3);
    assert.equal(sameMapping.length, 2);
    assert.equal(otherMapping.length, 1);
    assert.notEqual(otherMapping[0].credential_version, selected.credential_version);
    const operationalRead = world.events.find(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.object_uid === otherMapping[0].object_uid &&
        event.credential_id === token.credential_id,
    );
    assert.ok(operationalRead);
    assert.deepEqual(sameMapping.map((event) => event.revision).sort(), [1, 2]);
    assert.equal(selected.revision, 2);
    assert.equal(selected.resource, token.credential_ref);
    assert.equal(selected.event_id, sameMapping.find((event) => event.revision === 2)?.event_id);
    assert.equal(record.source.planned_action_time, selected.event_time);
    assert.equal(record.source.captured.action_time, selected.event_time);
  }
});

test('the combined rule needs the source remote reference, not only the shared credential', () => {
  const spec = { seed: 22901, family: 'reconcile-hook' };
  const complete = buildCombinedSession(spec);
  stepCombined(complete, { tool: 'submit-rule', args: { rule: combinedReference() } });
  assert.equal(scoreCombined(complete).success, true);

  const weak = combinedReference();
  weak.joins.sourceCloud = weak.joins.sourceCloud.filter(
    (clause) => clause.left !== 'credential_ref',
  );
  const ablated = buildCombinedSession(spec);
  stepCombined(ablated, { tool: 'submit-rule', args: { rule: weak } });
  assert.equal(scoreCombined(ablated).success, false);
});

test('the combined rule needs the source revision bound to the redeemed read', () => {
  const spec = { seed: 22901, family: 'reconcile-hook' };
  const weak = combinedReference();
  weak.joins.sourceRead = weak.joins.sourceRead.filter((clause) => clause.left !== 'revision');
  const session = buildCombinedSession(spec);
  stepCombined(session, { tool: 'submit-rule', args: { rule: weak } });
  assert.equal(scoreCombined(session).success, false);
});

test('the combined rule needs the submitted Job resource', () => {
  const spec = { seed: 22901, family: 'reconcile-hook' };
  const weak = combinedReference();
  weak.joins.jobCloud = weak.joins.jobCloud.filter(
    (clause) => clause.from !== 'submission' || clause.left !== 'resource',
  );
  const session = buildCombinedSession(spec);
  stepCombined(session, { tool: 'submit-rule', args: { rule: weak } });
  assert.equal(scoreCombined(session).success, false);
});

test('one Job run renews native credentials and binds its target read to the new role', () => {
  const world = buildNativeWorld({
    seed: 22801,
    family: 'reconcile-hook',
    linkAmbiguity: true,
    jobRenewal: true,
  });
  for (const record of Object.values(world.nativeActionRecords)) {
    const target = world.events.find((event) => event.event_id === record.job.action.event_id);
    const role = world.events.find((event) => event.event_id === target.causal_ref);
    const web = world.events.find((event) => event.event_id === role.causal_ref);
    const request = world.events.find((event) => event.event_id === web.causal_ref);
    const requests = world.events.filter(
      (event) => event.kind === 'runtime-credential-request' && event.pod_uid === request.pod_uid,
    );
    const roles = world.events.filter(
      (event) =>
        event.kind === 'sts-assume-role' &&
        requests.some((candidate) => {
          const linkedWeb = world.events.find((item) => item.causal_ref === candidate.event_id);
          return linkedWeb?.event_id === event.causal_ref;
        }),
    );
    assert.equal(requests.length, 2);
    assert.equal(roles.length, 2);
    assert.equal(role.access_key_ref, target.access_key_ref);
    assert.equal(role.source_access_key_ref, web.access_key_ref);
    assert.ok(requests.every((item) => item.outcome === undefined || item.outcome === 'completed'));
    assert.equal(record.job.planned_action_time, target.event_time);
    assert.equal(record.job.captured.action_time, target.event_time);
  }
});

test('combined Job has separately authorized operational read and checkpoint', () => {
  const world = buildNativeWorld({
    seed: 22901,
    family: 'reconcile-hook',
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
  });
  for (const record of Object.values(world.nativeActionRecords)) {
    const operational = record.operational;
    const read = world.events.find((event) => event.event_id === operational.read_event_id);
    const checkpoint = world.events.find(
      (event) =>
        event.kind === 'job-checkpoint-created' &&
        event.cloud_read_event_id === operational.read_event_id,
    );
    assert.ok(read && checkpoint);
    assert.equal(read.outcome, 'completed');
    assert.equal(read.authorization_snapshot_ref, operational.authorization_snapshot_ref);
    assert.equal(checkpoint.resource, read.resource);
    assert.equal(checkpoint.causal_ref, read.event_id);
    assert.notEqual(read.resource, record.job.action.resource);
  }
});
