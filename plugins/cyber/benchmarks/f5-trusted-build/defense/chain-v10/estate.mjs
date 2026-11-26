// F5 v10 customer-data recovery layered on the frozen v9 release estate.
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  makeIncident as makeSoftwareIncident,
  initial as softwareInitial,
  result as softwareResult,
  step as softwareStep,
  CASE_SEEDS as V9_SEEDS,
} from '../chain-v9/estate.mjs';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = (kind, seed, tag) => `${kind}-${hash(`f5-v10|${kind}|${seed}|${tag}`).slice(0, 12)}`;

export const CASE_SEEDS = Object.freeze([...V9_SEEDS]);
export const PROFILES = Object.freeze(['migration-write', 'customer-edit']);
export const caseToken = (seed, profile) =>
  `case-${hash(`f5-v10|${seed}|${profile}`).slice(0, 16)}`;

export function resolveCaseToken(token) {
  for (const seed of CASE_SEEDS) {
    for (const profile of PROFILES) {
      if (caseToken(seed, profile) === token) {
        return { seed, profile };
      }
    }
  }
  throw Error('unknown case token');
}

export function makeIncident({ seed, profile }) {
  if (!CASE_SEEDS.includes(seed) || !PROFILES.includes(profile)) {
    throw Error('invalid case');
  }
  const software = makeSoftwareIncident({ seed, profile: 'executable-divergence' });
  const installation = software.installations.find((row) => row.migrated_format === 3);
  const recordId = installation.existing_record;
  const migrationId = id('migration-job', seed, 'format-3');
  const cycleRequestId = id('customer-request', seed, 'cycle');
  const addressRequestId = id('customer-request', seed, 'address');
  const before = {
    billing_cycle: 'annual',
    notification_address: 'billing-original@example.test',
  };
  const record = {
    billing_cycle: 'monthly',
    notification_address: 'billing-updated@example.test',
  };
  const cycleActor = profile === 'migration-write' ? migrationId : cycleRequestId;
  const events = [
    {
      id: id('write', seed, 'format-marker'),
      transaction_id: id('transaction', seed, 'migration'),
      record: recordId,
      field: 'format',
      before: 2,
      after: 3,
      actor_id: migrationId,
      principal_type: 'migration-service',
      committed_at: '2041-03-05T09:50:00Z',
    },
    {
      id: id('write', seed, 'cycle'),
      transaction_id: id('transaction', seed, 'cycle'),
      record: recordId,
      field: 'billing_cycle',
      before: 'annual',
      after: 'monthly',
      actor_id: cycleActor,
      principal_type: profile === 'migration-write' ? 'migration-service' : 'customer',
      committed_at: '2041-03-05T09:52:00Z',
    },
    {
      id: id('write', seed, 'address'),
      transaction_id: id('transaction', seed, 'address'),
      record: recordId,
      field: 'notification_address',
      before: before.notification_address,
      after: record.notification_address,
      actor_id: addressRequestId,
      principal_type: 'customer',
      committed_at: '2041-03-05T10:02:00Z',
    },
  ];
  const jobs = [
    {
      id: migrationId,
      target_format: 3,
      completed: true,
      record: recordId,
      intended_fields: ['format'],
      committed_writes: events.filter((row) => row.actor_id === migrationId).map((row) => row.id),
    },
  ];
  const requests = [
    ...(profile === 'customer-edit'
      ? [
          {
            id: cycleRequestId,
            customer_authorized: true,
            record: recordId,
            field: 'billing_cycle',
            requested_value: 'monthly',
            committed_write: events[1].id,
          },
        ]
      : []),
    {
      id: addressRequestId,
      customer_authorized: true,
      record: recordId,
      field: 'notification_address',
      requested_value: record.notification_address,
      committed_write: events[2].id,
    },
  ];
  return {
    software,
    seed,
    profile,
    data: {
      cohort: installation.cohort,
      recordId,
      snapshot: { id: id('snapshot', seed, 'pre-migration'), record: recordId, ...before },
      record,
      events,
      jobs,
      requests,
      version: 3,
      lastVerifiedVersion: -1,
      actionLog: [],
    },
    submitted: false,
  };
}

export function initial() {
  const software = softwareInitial();
  return {
    ...software,
    alert: `${software.alert} The same release migrated a customer record. Determine whether restoring approved software also leaves the customer's billing data correct. Preserve later authorized edits.`,
    policy: {
      ...software.policy,
      data: 'The append-only write ledger records committed writers. Join migration jobs and customer-request receipts to distinguish a migration side effect from an authorized edit. A pre-migration snapshot and approved field-scoped repair are available. Preserve later authorized writes and verify the record through the running service after recovery.',
    },
    input: `${software.input} Data queries: {op:"record"}, {op:"write-ledger"}, {op:"migration-jobs"}, {op:"customer-requests"}, {op:"snapshot"}, {op:"repair-policy"}. Data controls: {op:"restore-field",field:"billing_cycle"}, {op:"restore-record"}. open-record also returns the current record fields when readable.`,
  };
}

export function step(estate, command) {
  if (estate.submitted) {
    return { error: 'already-submitted' };
  }
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return { error: 'invalid-command' };
  }
  const { op } = command;
  if (op === 'record') {
    return {
      record: {
        id: estate.data.recordId,
        format: 3,
        ...structuredClone(estate.data.record),
      },
    };
  }
  if (op === 'write-ledger') {
    return { events: structuredClone(estate.data.events) };
  }
  if (op === 'migration-jobs') {
    return { jobs: structuredClone(estate.data.jobs) };
  }
  if (op === 'customer-requests') {
    return { requests: structuredClone(estate.data.requests) };
  }
  if (op === 'snapshot') {
    return { snapshot: structuredClone(estate.data.snapshot) };
  }
  if (op === 'repair-policy') {
    return {
      approved: true,
      record: estate.data.recordId,
      allowed: ['restore-field:billing_cycle', 'restore-record'],
      source: estate.data.snapshot.id,
      condition:
        'Use only for a confirmed erroneous migration write. Preserve subsequent customer-authorized writes.',
    };
  }
  if (op === 'restore-field' || op === 'restore-record') {
    if (op === 'restore-field' && command.field !== 'billing_cycle') {
      return { error: 'field-not-approved' };
    }
    const old = structuredClone(estate.data.record);
    if (op === 'restore-field') {
      estate.data.record.billing_cycle = estate.data.snapshot.billing_cycle;
    } else {
      estate.data.record = {
        billing_cycle: estate.data.snapshot.billing_cycle,
        notification_address: estate.data.snapshot.notification_address,
      };
    }
    estate.data.version += 1;
    estate.data.events.push({
      id: id('write', estate.seed, `repair-${estate.data.version}`),
      transaction_id: id('transaction', estate.seed, `repair-${estate.data.version}`),
      record: estate.data.recordId,
      field: op === 'restore-field' ? 'billing_cycle' : 'record',
      before: old,
      after: structuredClone(estate.data.record),
      actor_id: 'approved-recovery-operator',
      principal_type: 'repair',
      committed_at: `2041-03-05T10:${String(10 + estate.data.version).padStart(2, '0')}:00Z`,
    });
    estate.data.actionLog.push({ op });
    return { accepted: true, record: structuredClone(estate.data.record) };
  }
  if (op === 'open-record') {
    const opened = softwareStep(estate.software, command);
    if (opened.opened && command.cohort === estate.data.cohort) {
      estate.data.lastVerifiedVersion = estate.data.version;
      return { ...opened, record: structuredClone(estate.data.record) };
    }
    return opened;
  }
  if (op === 'submit') {
    estate.submitted = true;
    softwareStep(estate.software, command);
    return { submitted: true, score: result(estate) };
  }
  return softwareStep(estate.software, command);
}

export function result(estate) {
  const base = softwareResult(estate.software);
  const expectedCycle = estate.profile === 'migration-write' ? 'annual' : 'monthly';
  const recordIntegrity = estate.data.record.billing_cycle === expectedCycle;
  const legitimateEditPreserved =
    estate.data.record.notification_address === 'billing-updated@example.test';
  const verifiedRead = estate.data.lastVerifiedVersion === estate.data.version;
  const softwareSafe =
    base.unsafe_installed === 0 &&
    base.unsafe_deployments === 0 &&
    base.outages === 0 &&
    base.collateral === 0 &&
    base.stopped_or_incompatible === 0;
  return {
    exact:
      base.exact && recordIntegrity && legitimateEditPreserved && verifiedRead && estate.submitted,
    software_safe: softwareSafe,
    record_integrity: recordIntegrity,
    legitimate_edit_preserved: legitimateEditPreserved,
    verified_read: verifiedRead,
    software: base,
    data_actions: estate.data.actionLog.length,
  };
}

// Uses only the observations and commands available through the defender's interface.
export function softwareOnly(estate, { submit = true } = {}) {
  const inputs = step(estate, { op: 'approved-inputs' }).inputs;
  const builds = step(estate, { op: 'builds' }).builds;
  const installations = step(estate, { op: 'installations' }).installations;
  const migrations = step(estate, { op: 'migrations' }).migrations;
  const artifacts = step(estate, { op: 'artifacts' }).artifacts;
  const approvals = step(estate, { op: 'approvals' }).approvals;
  const independent = step(estate, { op: 'rebuild', ...inputs, cache: 'isolated' }).build;
  if (new Set(builds.map((row) => row.cache_origin)).size !== 1) {
    throw Error('not the expected shared-cache evidence');
  }
  for (const installation of installations) {
    const platform = installation.platform;
    if (
      builds[0].outputs[platform].executable_sha256 ===
      independent.outputs[platform].executable_sha256
    ) {
      continue;
    }
    const candidate = artifacts.find(
      (row) =>
        row.platform === platform &&
        row.cache_origin === 'isolated' &&
        row.signature === 'valid' &&
        row.source_revision === inputs.source_revision &&
        row.dependency_lock_sha256 === inputs.dependency_lock_sha256 &&
        isDeepStrictEqual(row.build_settings, inputs.build_settings) &&
        row.readable_formats.includes(installation.migrated_format) &&
        approvals.some(
          (approval) =>
            approval.id === row.approval_id &&
            approval.state === 'approved' &&
            approval.platforms.includes(platform) &&
            approval.artifact_digests.includes(row.artifact_digest),
        ),
    );
    if (
      !candidate ||
      !step(estate, {
        op: 'install',
        cohort: installation.cohort,
        artifact: candidate.artifact_digest,
      }).accepted
    ) {
      throw Error('no approved compatible recovery');
    }
  }
  const migrated = migrations.find((row) => row.current_format === 3);
  if (
    !step(estate, { op: 'open-record', cohort: migrated.cohort, record: migrated.existing_record })
      .opened
  ) {
    throw Error('record unavailable after software recovery');
  }
  return submit ? step(estate, { op: 'submit' }).score : result(estate);
}

export function snapshotRollback(estate) {
  softwareOnly(estate, { submit: false });
  const migrated = step(estate, { op: 'migrations' }).migrations.find(
    (row) => row.current_format === 3,
  );
  step(estate, { op: 'restore-record' });
  step(estate, { op: 'open-record', cohort: migrated.cohort, record: migrated.existing_record });
  return step(estate, { op: 'submit' }).score;
}

export function visibleReference(estate) {
  softwareOnly(estate, { submit: false });
  const migrated = step(estate, { op: 'migrations' }).migrations.find(
    (row) => row.current_format === 3,
  );
  const record = step(estate, { op: 'record' }).record;
  const ledger = step(estate, { op: 'write-ledger' }).events;
  const jobs = step(estate, { op: 'migration-jobs' }).jobs;
  const requests = step(estate, { op: 'customer-requests' }).requests;
  const snapshot = step(estate, { op: 'snapshot' }).snapshot;
  const policy = step(estate, { op: 'repair-policy' });
  const cycleWrite = ledger.find(
    (row) => row.record === record.id && row.field === 'billing_cycle',
  );
  if (!cycleWrite) {
    throw Error('missing billing-cycle provenance');
  }
  const erroneousMigration =
    cycleWrite.principal_type === 'migration-service' &&
    jobs.some(
      (job) =>
        job.id === cycleWrite.actor_id &&
        job.completed &&
        job.committed_writes.includes(cycleWrite.id) &&
        !job.intended_fields.includes('billing_cycle'),
    ) &&
    !requests.some((request) => request.committed_write === cycleWrite.id);
  if (erroneousMigration) {
    if (!policy.approved || snapshot.billing_cycle === record.billing_cycle) {
      throw Error('repair basis unavailable');
    }
    step(estate, { op: 'restore-field', field: 'billing_cycle' });
    step(estate, { op: 'open-record', cohort: migrated.cohort, record: migrated.existing_record });
  } else if (
    !requests.some(
      (request) =>
        request.committed_write === cycleWrite.id &&
        request.customer_authorized &&
        request.requested_value === record.billing_cycle,
    )
  ) {
    throw Error('unexplained billing-cycle write');
  }
  return step(estate, { op: 'submit' }).score;
}

// A routine runbook: recover software, identify the writer of the changed field,
// check for a matching customer request, then repair only that field if needed.
export function ordinaryProcedure(estate) {
  softwareOnly(estate, { submit: false });
  const migrated = step(estate, { op: 'migrations' }).migrations.find(
    (row) => row.current_format === 3,
  );
  const record = step(estate, { op: 'record' }).record;
  const writes = step(estate, { op: 'write-ledger' }).events;
  const requests = step(estate, { op: 'customer-requests' }).requests;
  const jobs = step(estate, { op: 'migration-jobs' }).jobs;
  const cycle = writes.find((row) => row.record === record.id && row.field === 'billing_cycle');
  const customerRequested = requests.some(
    (request) =>
      request.customer_authorized &&
      request.committed_write === cycle.id &&
      request.requested_value === cycle.after,
  );
  const migrationCommitted = jobs.some(
    (job) => job.completed && job.id === cycle.actor_id && job.committed_writes.includes(cycle.id),
  );
  if (migrationCommitted && !customerRequested) {
    const snapshot = step(estate, { op: 'snapshot' }).snapshot;
    const policy = step(estate, { op: 'repair-policy' });
    if (!policy.approved || snapshot.billing_cycle !== cycle.before) {
      throw Error('ordinary procedure lacks a repair basis');
    }
    step(estate, { op: 'restore-field', field: 'billing_cycle' });
    step(estate, { op: 'open-record', cohort: migrated.cohort, record: migrated.existing_record });
  } else if (!customerRequested) {
    throw Error('ordinary procedure cannot establish the writer');
  }
  return step(estate, { op: 'submit' }).score;
}
