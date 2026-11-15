import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, captureNativeCoverage } from '../v9/defense.mjs';

const spec = (seed, family) => ({
  seed,
  family,
  sourceAmbiguity: true,
  sourceRevisionRace: true,
  linkAmbiguity: true,
  operationalCheckpoint: true,
  jobRenewal: true,
  approvalContext: true,
});

function repairOneApproval(record, cause, scope) {
  const grants = structuredClone(record.grants);
  const ledger = structuredClone(record.ledger);
  const action = record.action;
  const groupGrant = grants.find((grant) => grant.writer_principal.startsWith('group:'));
  assert.ok(groupGrant, 'protected group grant missing');
  if (cause.endsWith('membership')) {
    const last = ledger
      .filter(
        (event) =>
          event.group_principal === groupGrant.writer_principal &&
          event.member_principal === action.actor &&
          event.event_time < action.event_time,
      )
      .sort((left, right) => right.event_time - left.event_time)[0];
    assert.equal(last?.kind, 'group-member-removed');
    last.kind = 'group-member-added';
  } else if (cause.endsWith('expired')) {
    groupGrant.scope.valid_until = action.event_time + 1;
  } else if (cause.endsWith('not-yet-valid')) {
    groupGrant.scope.valid_from = action.event_time;
  } else if (cause === 'source-controller') {
    groupGrant.scope.controller_id = scope.controller_id;
  } else if (cause === 'job-service-account') {
    groupGrant.scope.service_account_id = scope.service_account_id;
  } else if (cause === 'job-template') {
    groupGrant.scope.template_id = scope.template_id;
  } else {
    throw new Error(`unknown approval cause ${cause}`);
  }
  return captureNativeCoverage(
    grants,
    ledger,
    action.actor,
    action.action,
    action.resource,
    action.event_time,
    scope,
  ).authorized;
}

test('native approval requires matching workload scope and action-time validity', () => {
  const grant = {
    writer_principal: 'group:ops',
    task: { action: 's3:GetObject', remote_ref: 's3://tenant/export' },
    scope: {
      service_account_id: 'sa:export',
      template_id: 'tmpl:signed',
      valid_from: 50,
      valid_until: 90,
    },
  };
  const ledger = [
    {
      kind: 'group-member-added',
      outcome: 'completed',
      event_time: 49,
      group_principal: 'group:ops',
      member_principal: 'user:submit',
    },
  ];
  const capture = (scope, time = 60) =>
    captureNativeCoverage(
      [grant],
      ledger,
      'user:submit',
      's3:GetObject',
      's3://tenant/export',
      time,
      scope,
    ).authorized;
  assert.equal(
    capture({ kind: 'job', service_account_id: 'sa:export', template_id: 'tmpl:signed' }),
    true,
  );
  assert.equal(
    capture({ kind: 'job', service_account_id: 'sa:other', template_id: 'tmpl:signed' }),
    false,
  );
  assert.equal(
    capture({ kind: 'job', service_account_id: 'sa:export', template_id: 'tmpl:other' }),
    false,
  );
  assert.equal(
    capture({ kind: 'job', service_account_id: 'sa:export', template_id: 'tmpl:signed' }, 90),
    false,
  );
  assert.equal(
    capture({ kind: 'job', service_account_id: 'sa:export', template_id: 'tmpl:signed' }, 50),
    true,
  );
});

test('v15 native batches preserve completed reads and vary approval causes', () => {
  const causes = new Set();
  const separatedWriter = { approved: false, unauthorized: false };
  for (const family of FAMILIES) {
    for (const seed of [24701, 24702, 24703]) {
      const world = buildDefenseSession(spec(seed, family));
      const labels = Object.values(world.expected).sort();
      assert.deepEqual(labels, [
        'approved-automation',
        'approved-automation',
        'approved-automation',
        'full-cascade',
        'job-cascade',
        'source-cascade',
      ]);
      for (const [tokenId, record] of Object.entries(world.nativeActionRecords)) {
        const token = world.events.find((event) => event.event_id === tokenId);
        const source = world.events.find(
          (event) => event.event_id === record.source.action.event_id,
        );
        const job = world.events.find((event) => event.event_id === record.job.action.event_id);
        assert.equal(source?.outcome, 'completed');
        assert.equal(job?.outcome, 'completed');
        assert.equal(record.source.captured.action_time, source.event_time);
        assert.equal(record.job.captured.action_time, job.event_time);
        assert.equal(record.source.planned_action_time, source.event_time);
        assert.equal(record.job.planned_action_time, job.event_time);
        const sourceGrant = record.source.grants.find((grant) =>
          grant.writer_principal.startsWith('group:'),
        );
        const jobGrant = record.job.grants.find((grant) =>
          grant.writer_principal.startsWith('group:'),
        );
        assert.equal(typeof sourceGrant?.scope?.controller_id, 'string');
        assert.equal(typeof jobGrant?.scope?.service_account_id, 'string');
        assert.equal(typeof jobGrant?.scope?.template_id, 'string');
        const submission = world.events.find(
          (event) => event.kind === 'job-submitted' && event.auth_context_ref === tokenId,
        );
        assert.ok(submission);
        const backgroundSubmission = world.events.find(
          (event) =>
            event.kind === 'job-submitted' &&
            event.auth_context_ref === record.background.authorization_event_id,
        );
        const backgroundSnapshot = world.grantSnapshots.find(
          (item) => item.snapshot_ref === backgroundSubmission?.grant_snapshot_ref,
        );
        assert.ok(
          backgroundSnapshot?.grants.every(
            (grant) =>
              grant.scope?.service_account_id === backgroundSubmission.service_account_id &&
              grant.scope?.template_id === backgroundSubmission.template_id &&
              grant.scope.valid_from <= record.background.action.event_time &&
              record.background.action.event_time < grant.scope.valid_until,
          ),
        );
        if (record.source.approval_cause) {
          assert.equal(
            repairOneApproval(record.source, record.source.approval_cause, {
              kind: 'source',
              controller_id: source.controller_id,
            }),
            true,
          );
        }
        if (record.job.approval_cause) {
          assert.equal(
            repairOneApproval(record.job, record.job.approval_cause, {
              kind: 'job',
              service_account_id: submission.service_account_id,
              template_id: submission.template_id,
            }),
            true,
          );
        }
        if (record.source.action.actor !== token.actor) {
          separatedWriter[
            world.expected[tokenId] === 'approved-automation' ? 'approved' : 'unauthorized'
          ] = true;
        }
        causes.add(
          record.source.captured.authorized ? 'source-approved' : record.source.approval_cause,
        );
        causes.add(record.job.captured.authorized ? 'job-approved' : record.job.approval_cause);
      }
      assert.ok(
        world.grantSnapshots.every((snapshot) =>
          snapshot.grants.every((grant) => !Object.hasOwn(grant, 'authorized')),
        ),
      );
    }
  }
  assert.deepEqual(separatedWriter, { approved: true, unauthorized: true });
  for (const cause of [
    'source-membership',
    'source-controller',
    'source-expired',
    'source-not-yet-valid',
    'job-membership',
    'job-service-account',
    'job-template',
    'job-expired',
    'job-not-yet-valid',
  ]) {
    assert.ok(causes.has(cause), `missing native variation: ${cause}`);
  }
});
