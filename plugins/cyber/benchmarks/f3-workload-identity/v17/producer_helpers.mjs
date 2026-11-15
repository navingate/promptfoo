// V17-only native approval cases and publication scheduling. The visible rule
// interpreter deliberately does not import this module.
import { sha256Hex } from '../shared/estate.mjs';
import { createApprovalStream, publishApprovalRevision } from './approval_plane.mjs';

// [target, operational] approval states before and after the completed
// publication. The assignments are permuted per seed/family.
const CASES = [
  {
    order: 'target-first',
    change: [
      [true, true],
      [true, true],
    ],
    owner: [
      [true, true],
      [true, false],
    ],
  },
  {
    order: 'operational-first',
    change: [
      [true, true],
      [true, true],
    ],
    owner: [
      [true, true],
      [true, true],
    ],
  },
  {
    order: 'target-first',
    change: [
      [false, false],
      [false, true],
    ],
    owner: [
      [true, true],
      [true, true],
    ],
  },
  {
    order: 'operational-first',
    change: [
      [true, true],
      [true, true],
    ],
    owner: [
      [true, true],
      [false, true],
    ],
  },
  {
    order: 'target-first',
    change: [
      [true, true],
      [true, false],
    ],
    owner: [
      [false, false],
      [true, false],
    ],
  },
  {
    order: 'operational-first',
    change: [
      [false, false],
      [true, false],
    ],
    owner: [
      [true, true],
      [true, true],
    ],
  },
];

export function dualApprovalCase(spec, index) {
  const order = CASES.map((_, position) => position).sort((left, right) =>
    sha256Hex(`f3v17|case|${spec.seed}|${spec.family}|${left}`).localeCompare(
      sha256Hex(`f3v17|case|${spec.seed}|${spec.family}|${right}`),
    ),
  );
  return CASES[order[index]];
}

export function dualLaneGrants(
  base,
  states,
  targetRef,
  operationalRef,
  route,
  alternateAccountId,
  maxTime,
) {
  const grants = structuredClone(base);
  for (const grant of grants) {
    const ref = grant.task.remote_ref;
    const role = ref === targetRef ? 0 : ref === operationalRef ? 1 : null;
    const covered = role === null || states[role];
    grant.scope = {
      service_account_id: covered ? route.service_account_id : alternateAccountId,
      template_id: route.template_id,
      valid_from: 0,
      valid_until: maxTime + 100,
    };
  }
  return grants;
}

export function scheduleApprovalStreams({
  seed,
  family,
  recordPrefix,
  baseRefs,
  baseGrants,
  states,
  targetRef,
  operationalRef,
  route,
  alternateAccountId,
  maxTime,
  auditStreamRef,
  failedTime,
  completedTime,
}) {
  if (!(Number.isSafeInteger(failedTime) && failedTime < completedTime)) {
    throw new Error('approval publication schedule invalid');
  }
  return Object.fromEntries(
    ['change', 'owner'].map((name) => {
      const stream = createApprovalStream({
        seed,
        family,
        recordRef: `${recordPrefix}|${name}`,
        baseSnapshotRef: baseRefs[name],
        grants: baseGrants[name],
        auditStreamRef,
      });
      publishApprovalRevision(stream, {
        grants: dualLaneGrants(
          baseGrants[name],
          states[name][0].map((value) => !value),
          targetRef,
          operationalRef,
          route,
          alternateAccountId,
          maxTime,
        ),
        eventTime: failedTime,
        arrivalOrder: 2,
        outcome: 'failed',
      });
      publishApprovalRevision(stream, {
        grants: dualLaneGrants(
          baseGrants[name],
          states[name][1],
          targetRef,
          operationalRef,
          route,
          alternateAccountId,
          maxTime,
        ),
        eventTime: completedTime,
        arrivalOrder: 1,
        outcome: 'completed',
      });
      return [name, stream];
    }),
  );
}

export function visibleApprovalSnapshots(streams, visibleGrant, includeChangeBase = false) {
  return [
    ...(includeChangeBase ? streams.change.snapshots : streams.change.snapshots.slice(1)),
    ...streams.owner.snapshots,
  ].map((snapshot) => ({ ...snapshot, grants: snapshot.grants.map(visibleGrant) }));
}

export function approvalPublications(streams) {
  return [...streams.change.publications, ...streams.owner.publications].map((event) => ({
    ...event,
  }));
}

export function verifyDualApprovalMatrix(incidents) {
  const counts = { source: 0, target: 0, operational: 0, first: 0, second: 0 };
  const states = new Set();
  const combinations = new Set();
  for (const incident of incidents) {
    const record = incident.nativeActionRecords;
    const reads = record.job.reads;
    if (reads?.length !== 2) {
      throw new Error('dual approval Job read population missing');
    }
    counts.source += Number(!record.source.captured.authorized);
    const byTime = [...reads].sort(
      (left, right) => left.action.event_time - right.action.event_time,
    );
    counts.first += Number(!byTime[0].captured.authorized);
    counts.second += Number(!byTime[1].captured.authorized);
    for (const read of reads) {
      const lanes = read.approval_lanes;
      if (
        !lanes ||
        typeof lanes.change?.authorized !== 'boolean' ||
        typeof lanes.owner?.authorized !== 'boolean' ||
        read.captured.authorized !== (lanes.change.authorized && lanes.owner.authorized)
      ) {
        throw new Error('dual approval lane capture missing');
      }
      counts[read.role] += Number(!read.captured.authorized);
      states.add(`${lanes.change.authorized}/${lanes.owner.authorized}`);
    }
    const target = reads.find((read) => read.role === 'target');
    const operational = reads.find((read) => read.role === 'operational');
    combinations.add(`${target?.captured.authorized}/${operational?.captured.authorized}`);
  }
  if (
    incidents.length !== 6 ||
    counts.source !== 2 ||
    counts.target !== 3 ||
    counts.operational !== 3 ||
    counts.first !== 3 ||
    counts.second !== 3 ||
    states.size !== 4 ||
    combinations.size !== 4
  ) {
    throw new Error('dual approval counterfactual matrix incomplete');
  }
}
