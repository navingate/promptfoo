import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, captureNativeCoverage } from '../v9/defense.mjs';

function spec(seed, family, perReadApproval = true) {
  return {
    seed,
    family,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval,
  };
}

function nativeCovered(
  record,
  read,
  submission,
  grants = record.job.grants,
  ledger = record.job.ledger,
) {
  return captureNativeCoverage(
    grants,
    ledger,
    read.action.actor,
    read.action.action,
    read.action.resource,
    read.action.event_time,
    {
      kind: 'job',
      service_account_id: submission.service_account_id,
      template_id: submission.template_id,
    },
  ).authorized;
}

function repairedCoverage(record, read, submission) {
  const grants = structuredClone(record.job.grants);
  const ledger = structuredClone(record.job.ledger);
  const grant = grants.find(
    (item) =>
      item.task.action === read.action.action &&
      item.task.remote_ref === read.action.resource &&
      (read.role === 'target'
        ? item.writer_principal.startsWith('group:')
        : item.writer_principal === read.action.actor),
  );
  assert.ok(grant, `${read.role} approval grant missing`);
  const cause = read.approval_cause;
  assert.equal(typeof cause, 'string');
  if (cause.endsWith('membership')) {
    const last = ledger
      .filter(
        (item) =>
          item.group_principal === grant.writer_principal &&
          item.member_principal === read.action.actor &&
          item.event_time < read.action.event_time,
      )
      .sort((left, right) => right.event_time - left.event_time)[0];
    assert.equal(last?.kind, 'group-member-removed');
    last.kind = 'group-member-added';
  } else if (cause.endsWith('service-account')) {
    grant.scope.service_account_id = submission.service_account_id;
  } else if (cause.endsWith('template')) {
    grant.scope.template_id = submission.template_id;
  } else if (cause.endsWith('expired')) {
    grant.scope.valid_until = read.action.event_time + 1;
  } else if (cause.endsWith('not-yet-valid')) {
    grant.scope.valid_from = read.action.event_time;
  } else {
    throw new Error(`unexpected approval cause: ${cause}`);
  }
  const repaired = nativeCovered(record, read, submission, grants, ledger);
  const other = record.job.reads.find((item) => item.role !== read.role);
  const otherAfterRepair = nativeCovered(record, other, submission, grants, ledger);
  return { repaired, otherAfterRepair };
}

test('v16 captures both completed reads under one Job session with independent native approvals', () => {
  const causes = new Set();
  const bothSourceStatuses = new Set();
  for (const family of FAMILIES) {
    for (const seed of [34001, 34002, 34003, 34004]) {
      const world = buildDefenseSession(spec(seed, family));
      const combinations = new Set();
      let sourceUncovered = 0;
      let targetUncovered = 0;
      let operationalUncovered = 0;
      let tokenCount = 0;
      for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
        tokenCount += 1;
        assert.equal(record.job.reads.length, 2);
        assert.deepEqual(record.job.reads.map((read) => read.role).sort(), [
          'operational',
          'target',
        ]);
        const submission = world.events.find(
          (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
        );
        assert.ok(submission);
        const admission = world.events.find(
          (event) =>
            event.kind === 'job-admission' &&
            event.job_uid === submission.job_uid &&
            event.outcome === 'admitted',
        );
        const pod = world.events.find(
          (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
        );
        assert.equal(admission?.causal_ref, submission.event_id);
        assert.equal(pod?.service_account_id, submission.service_account_id);
        const [target, operational] = ['target', 'operational'].map((role) =>
          record.job.reads.find((read) => read.role === role),
        );
        combinations.add(`${target.captured.authorized}/${operational.captured.authorized}`);
        sourceUncovered += Number(record.source.captured.authorized === false);
        targetUncovered += Number(target.captured.authorized === false);
        operationalUncovered += Number(operational.captured.authorized === false);
        if (!target.captured.authorized && !operational.captured.authorized) {
          bothSourceStatuses.add(record.source.captured.authorized);
        }
        assert.equal(record.job.action.event_id, target.action.event_id);
        assert.equal(record.job.captured.authorized, target.captured.authorized);
        assert.equal(record.job.run_read_event_id, target.action.event_id);
        const reads = [target, operational].map((entry) =>
          world.events.find((event) => event.event_id === entry.action.event_id),
        );
        assert.ok(reads.every((entry) => entry?.kind === 'cloud-object-read'));
        assert.ok(reads.every((entry) => entry.outcome === 'completed'));
        assert.equal(reads[0].access_key_ref, reads[1].access_key_ref);
        assert.equal(reads[0].causal_ref, reads[1].causal_ref);
        assert.notEqual(reads[0].resource, reads[1].resource);
        for (const read of record.job.reads) {
          const native = world.events.find((event) => event.event_id === read.action.event_id);
          const checkpoint = world.events.find(
            (event) => event.event_id === read.checkpoint_event_id,
          );
          assert.equal(read.action.event_time, native.event_time);
          assert.equal(read.action.actor, submission.actor);
          assert.equal(read.planned_action_time, native.event_time);
          assert.equal(read.captured.action_time, native.event_time);
          assert.equal(read.captured.authorized, nativeCovered(record, read, submission));
          assert.equal(checkpoint?.kind, 'job-checkpoint-created');
          assert.equal(checkpoint?.cloud_read_event_id, native.event_id);
          assert.equal(checkpoint?.causal_ref, native.event_id);
          assert.equal(checkpoint?.job_uid, submission.job_uid);
          if (!read.captured.authorized) {
            causes.add(read.approval_cause);
            const repaired = repairedCoverage(record, read, submission);
            assert.equal(repaired.repaired, true, `${seed}/${family}/${read.role}`);
            assert.equal(
              repaired.otherAfterRepair,
              record.job.reads.find((entry) => entry.role !== read.role).captured.authorized,
              `${seed}/${family}: repairing ${read.role} changed the other read`,
            );
          }
        }
      }
      assert.equal(tokenCount, 6);
      assert.equal(sourceUncovered, 2);
      assert.equal(targetUncovered, 2);
      assert.equal(operationalUncovered, 2);
      assert.deepEqual(
        combinations,
        new Set(['false/false', 'false/true', 'true/false', 'true/true']),
      );
      assert.equal(/"authorized"\s*:/.test(JSON.stringify(world.events)), false);
      assert.equal(/"authorized"\s*:/.test(JSON.stringify(world.grantSnapshots)), false);
    }
  }
  assert.deepEqual(bothSourceStatuses, new Set([false, true]));
  for (const cause of [
    'job-operational-service-account',
    'job-operational-template',
    'job-operational-expired',
    'job-operational-not-yet-valid',
  ]) {
    assert.ok(causes.has(cause), `missing operational near miss: ${cause}`);
  }
});

test('v15 native records remain target-only without v16 flag', () => {
  const world = buildDefenseSession(spec(34001, FAMILIES[0], false));
  for (const record of Object.values(world.nativeActionRecords)) {
    assert.equal(Object.hasOwn(record.job, 'reads'), false);
    assert.equal(typeof record.job.captured.authorized, 'boolean');
  }
});
