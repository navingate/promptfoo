import { planReferenceContainment } from '../v20/reference.mjs';
import {
  buildDefenseSession as buildV23DefenseSession,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { resolveIndex } from './ledger.mjs';
import { buildEpisode } from './producer.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from './queries.mjs';

const READ_TOOLS = { listWorkloads, querySource, queryWorkload, querySession };
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

export function buildDefenseSession(spec) {
  const session = buildV23DefenseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    actionBudget: 16,
    queryBudget: 31,
    readTools: READ_TOOLS,
  });
  session.initial.runbook.push(
    'The workload index includes adjacent archive partitions. For each indexed ID, start at its base snapshot. In event-time and arrival order, completed publications advance to the named new snapshot; failed publications do not. A failed stale-predecessor proposal is not the effective head. Query only IDs whose effective planned_at is at or after triage_time and strictly before horizon_end. Archive queries consume the same evidence budget.',
  );
  session.initial.tools['list-workloads'].returns =
    'triage index of candidate credential, Job and session IDs with revisioned observation windows';
  return session;
}

export function stepDefense(session, command) {
  return stepV23Defense(session, command);
}

export function scoreDefense(session) {
  return scoreV23Defense(session);
}

export function referenceDefense(session) {
  // Only ordinary read-only replies enter this reference; no producer state.
  const query = (tool, args = {}) => {
    const result = stepDefense(session, { tool, args });
    if (!result.ok) {
      throw new Error(`v30 reference ${tool} failed: ${result.reason}`);
    }
    return result.evidence;
  };
  const index = query('list-workloads');
  const selected = resolveIndex(index);
  const maps = Object.fromEntries(Object.keys(IDENTITIES).map((key) => [key, new Map()]));
  const absorb = (evidence) => {
    for (const [key, identity] of Object.entries(IDENTITIES)) {
      for (const item of evidence[key] ?? []) {
        const id = item[identity];
        if (typeof id !== 'string' || !id) {
          throw new Error(`v30 reference ${key} record lacks ${identity}`);
        }
        const existing = maps[key].get(id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
          throw new Error(`v30 reference ${key} record conflicts at ${id}`);
        }
        maps[key].set(id, item);
      }
    }
  };
  for (const credential_id of selected.credential_ids) {
    absorb(query('query-source', { credential_id }));
  }
  for (const job_uid of selected.job_uids) {
    absorb(query('query-workload', { job_uid }));
  }
  for (const access_key_ref of selected.access_key_refs) {
    absorb(query('query-session', { access_key_ref }));
  }
  const visible = {
    triage_time: index.triage_time,
    arrival_watermark: index.arrival_watermark,
    horizon_end: index.horizon_end,
    ...Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, [...map.values()]])),
  };
  return planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
}
