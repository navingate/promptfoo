import { actionFromCommand } from '../v18/defense.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import {
  buildDefenseSession as buildV23DefenseSession,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { selectorKey } from '../v31/cohorts.mjs';
import { canQueryDetail, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { solveMixedCover } from './catalog.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const PRIVATE = new WeakMap();
const IDENTITIES = {
  events: 'event_id',
  grant_snapshots: 'snapshot_ref',
  approval_snapshots: 'snapshot_ref',
  approval_publications: 'event_id',
  membership_audit: 'event_id',
  policy_snapshots: 'snapshot_ref',
  session_register: 'access_key_ref',
  job_queue: 'job_uid',
};

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredKeys(index) {
  const selected = resolveIndex(index);
  return new Set([
    ...selected.credential_ids.map((entry_id) =>
      scheduleKey({ entry_type: 'credential', entry_id }),
    ),
    ...selected.job_uids.map((entry_id) => scheduleKey({ entry_type: 'job', entry_id })),
    ...selected.access_key_refs.map((entry_id) => scheduleKey({ entry_type: 'session', entry_id })),
  ]);
}

function parseAction(visible, command) {
  if (Object.keys(command).length !== 2 || !Object.hasOwn(command, 'args')) {
    return null;
  }
  if (command.tool !== 'quarantine-cohort' && command.tool !== 'except-cohort') {
    return actionFromCommand(visible, command);
  }
  const args = command.args;
  const field = command.tool === 'quarantine-cohort' ? 'cohort_id' : 'exception_id';
  const groups =
    command.tool === 'quarantine-cohort'
      ? visible.containment_cohorts.cohorts
      : visible.exception_bundles.bundles;
  if (
    Object.keys(command).length !== 2 ||
    !record(args) ||
    Object.keys(args).length !== 1 ||
    typeof args[field] !== 'string' ||
    !groups.some((group) => group[field] === args[field])
  ) {
    return null;
  }
  return { tool: command.tool, args: { [field]: args[field] } };
}

function readToolsFor(state) {
  const detail = (visible, type, id, delegate) => {
    state.ordinal += 1;
    if (
      state.required === null ||
      !canQueryDetail(visible.query_access_schedule, type, id, state.ordinal, state.successful)
    ) {
      return null;
    }
    const evidence = delegate(visible, id);
    if (evidence !== null) {
      state.successful.add(scheduleKey({ entry_type: type, entry_id: id }));
    }
    return evidence;
  };
  return {
    listWorkloads(visible) {
      state.ordinal += 1;
      const index = {
        ...listWorkloads(visible),
        query_access_schedule: structuredClone(visible.query_access_schedule),
      };
      state.required = requiredKeys(index);
      return index;
    },
    querySource: (visible, id) => detail(visible, 'credential', id, querySource),
    queryWorkload: (visible, id) => detail(visible, 'job', id, queryWorkload),
    querySession: (visible, id) => detail(visible, 'session', id, querySession),
  };
}

export function buildDefenseSession(spec, producer = buildEpisode) {
  const state = { ordinal: 0, successful: new Set(), required: null };
  const session = buildV23DefenseSession(spec, {
    producer,
    replay: replayContainment,
    actionBudget: 4,
    queryBudget: 31,
    readTools: readToolsFor(state),
    parseAction,
    initialExtras: (visible) => ({
      containment_cohorts: visible.containment_cohorts,
      exception_bundles: visible.exception_bundles,
    }),
  });
  session.initial.runbook.push(
    'The workload index includes adjacent archive partitions. Resolve each ID’s effective snapshot from completed publications in event-time and arrival order. Failed publications leave the head unchanged. Query IDs whose effective planned_at is within the triage horizon.',
    'list-workloads returns query_access_schedule. The list is ordinal one; every later read-only call consumes the next ordinal, including mistimed and archive calls. An exact detail query returns records only within its inclusive query window and after every required typed ID has returned successfully. All thirty current detail records must be retrieved before submission. A missing one fails even if the containment controls are correct.',
    'Stage at most four containment requests, including quarantine-cohort, except-cohort and individual controls. At submission, two distinct quarantine cohorts must not overlap on any current Job or session selector. Duplicate cohort IDs always fail. Archive-only overlap is harmless; archives have no runtime effect. At most one exception bundle may be selected. The exception cancels bulk quarantine for its selectors, but never erases a quarantine overlap or cancels an individual pause, denial or role-wide revoke. Direct controls may overlap a cohort. Final blocked approved work is collateral failure; request acceptance gives no outcome verdict.',
  );
  session.initial.tools['list-workloads'].returns =
    'revisioned sixty-ID triage index and per-ID query access schedule';
  session.initial.tools['quarantine-cohort'] = {
    args: { cohort_id: 'exact ID in containment_cohorts.cohorts' },
    returns:
      'request selected current Job pauses and issued-session denials; archives have no effect; acceptance does not confirm safe outcomes',
  };
  session.initial.tools['except-cohort'] = {
    args: { exception_id: 'exact ID in exception_bundles.bundles' },
    returns:
      'stage one bundle that cancels bulk quarantine for listed selectors; it cannot undo direct controls; acceptance gives no outcome verdict',
  };
  PRIVATE.set(session, state);
  return session;
}

export function stepDefense(session, command) {
  return stepV23Defense(session, command);
}

export function scoreDefense(session) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v35 defense session');
  }
  const base = scoreV23Defense(session);
  if (!session.finished) {
    return base;
  }
  const missing =
    state.required === null
      ? 30
      : [...state.required].filter((key) => !state.successful.has(key)).length;
  return {
    ...base,
    success: base.success && missing === 0,
    reason:
      base.overlapping_current_quarantines > 0
        ? 'overlapping-current-quarantines'
        : missing > 0
          ? 'evidence-incomplete'
          : base.reason,
    missing_required_evidence_count: missing,
  };
}

function collectVisibleEvidence(session) {
  const query = (tool, args = {}) => {
    const result = stepDefense(session, { tool, args });
    if (!result.ok) {
      throw new Error(`v35 reference ${tool} failed: ${result.reason}`);
    }
    return result.evidence;
  };
  const index = query('list-workloads');
  const order = solveQuerySchedule(index);
  if (order === null) {
    throw new Error('v35 visible evidence has no feasible query schedule');
  }
  const maps = Object.fromEntries(Object.keys(IDENTITIES).map((key) => [key, new Map()]));
  for (const entry of order) {
    const evidence =
      entry.entry_type === 'credential'
        ? query('query-source', { credential_id: entry.entry_id })
        : entry.entry_type === 'job'
          ? query('query-workload', { job_uid: entry.entry_id })
          : query('query-session', { access_key_ref: entry.entry_id });
    for (const [key, identity] of Object.entries(IDENTITIES)) {
      for (const item of evidence[key] ?? []) {
        const id = item[identity];
        if (typeof id !== 'string' || !id) {
          throw new Error(`v35 reference ${key} record lacks ${identity}`);
        }
        const existing = maps[key].get(id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
          throw new Error(`v35 reference ${key} record conflicts at ${id}`);
        }
        maps[key].set(id, item);
      }
    }
  }
  return {
    triage_time: index.triage_time,
    arrival_watermark: index.arrival_watermark,
    horizon_end: index.horizon_end,
    ...Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, [...map.values()]])),
  };
}

export function referenceDefense(session) {
  const visible = collectVisibleEvidence(session);
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const current = new Map();
  for (const { job_uid } of visible.job_queue) {
    current.set(selectorKey({ kind: 'job', id: job_uid }), {
      tool: 'pause-job',
      args: { job_uid },
    });
  }
  for (const { access_key_ref, role_arn, role_session_name } of visible.session_register) {
    current.set(selectorKey({ kind: 'session', id: access_key_ref }), {
      tool: 'deny-role-session',
      args: { role_arn, role_session_name },
    });
  }
  const actions = solveMixedCover(
    {
      containment_cohorts: session.initial.containment_cohorts,
      exception_bundles: session.initial.exception_bundles,
    },
    current,
    required,
    { maxActions: 4 },
  );
  if (actions === null) {
    throw new Error('v35 visible evidence has no safe four-request containment plan');
  }
  return actions;
}
