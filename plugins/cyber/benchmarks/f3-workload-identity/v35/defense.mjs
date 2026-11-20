import { sha256Hex } from '../shared/estate.mjs';
import { actionFromCommand } from '../v18/defense.mjs';
import {
  buildDefenseSession as buildV23DefenseSession,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { selectorKey } from '../v31/cohorts.mjs';
import { canQueryDetail, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { resolvePrefix } from './prefix.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';
import { chooseStagedException, chooseStagedQuarantine } from './staged_plan.mjs';

const PRIVATE = new WeakMap();
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
  const state = {
    ordinal: 0,
    successful: new Set(),
    required: null,
    index: null,
    replies: [],
    staged: [],
    lastSuccessfulDetail: null,
    turnOpen: false,
    delivered: null,
  };
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
    'The emergency change board has four exact slots: stage quarantine-cohort immediately after query ordinals 20, 24 and 30, then except-cohort after successful query 31. The first quarantine needs six current selectors proven unsafe from evidence seen by ordinal 20; the second needs four new proven unsafe and two proven approved by ordinal 24; the third needs five new proven unsafe and one unresolved current Job by ordinal 30. Each quarantine has six current and two archive selectors. Its current selectors must be disjoint from earlier quarantines. The last query resolves the third quarantine’s unresolved Job. The exception must restore the two approved selectors, and also that Job if its final evidence proves approval. Accepted staging gives no outcome verdict; deadlines and evidence rules are checked at submission.',
    'When several commands are sent in one response, their results are delivered together afterward. A staged control may use only evidence delivered in a previous response. Send the exception in a later response than query 31.',
    'Exactly four original containment requests are available. Direct controls may be requested, but cannot fill a change-board quarantine slot. Duplicate cohort IDs or overlapping current selectors fail. Archive selectors have no runtime effect. The exception cancels bulk quarantine for its selectors only; it cannot cancel an individual pause, denial or role-wide revoke. Final controls must stop unauthorized planned reads without blocking approved work.',
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
  state.catalogs = structuredClone({
    containment_cohorts: session.initial.containment_cohorts,
    exception_bundles: session.initial.exception_bundles,
  });
  PRIVATE.set(session, state);
  return session;
}

/** Freeze the replies delivered before a model turn containing several commands. */
export function beginDefenseTurn(session) {
  const state = PRIVATE.get(session);
  if (!state || state.turnOpen || session.finished) {
    throw new Error('invalid v35 turn boundary');
  }
  state.delivered = {
    index: state.index,
    replies: state.replies.slice(),
    ordinal: state.ordinal,
  };
  state.turnOpen = true;
}

export function endDefenseTurn(session) {
  const state = PRIVATE.get(session);
  if (!state?.turnOpen) {
    throw new Error('invalid v35 turn boundary');
  }
  state.turnOpen = false;
  state.delivered = null;
}

export function stepDefense(session, command) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v35 defense session');
  }
  const strictEnvelopeTools = new Set([
    'list-workloads',
    'query-source',
    'query-workload',
    'query-session',
    'submit-plan',
  ]);
  const malformedEnvelope =
    record(command) &&
    strictEnvelopeTools.has(command.tool) &&
    (Object.keys(command).sort().join(',') !== 'args,tool' || !record(command.args));
  const delegated = malformedEnvelope
    ? { tool: command.tool, args: { invalid_envelope: true } }
    : command;
  const result = stepV23Defense(session, delegated);
  if (result.ok && result.evidence) {
    if (command.tool === 'list-workloads') {
      state.index = structuredClone(result.evidence);
    } else {
      state.replies.push({ ok: true, evidence: structuredClone(result.evidence) });
      state.lastSuccessfulDetail = {
        tool: command.tool,
        args: structuredClone(command.args),
        ordinal: state.ordinal,
      };
    }
  }
  if (result.ok && result.accepted) {
    const delivered = state.turnOpen
      ? state.delivered
      : { index: state.index, replies: state.replies, ordinal: state.ordinal };
    let prefixRows = null;
    if (delivered.index !== null) {
      try {
        prefixRows = resolvePrefix(delivered.index, delivered.replies);
      } catch {
        // Invalid evidence is scored at submission; acceptance reveals no verdict.
      }
    }
    state.staged.push({
      action: structuredClone(command),
      ordinal: state.ordinal,
      delivered_ordinal: delivered.ordinal,
      successful_detail_count: state.replies.length,
      transcript_digest: sha256Hex(JSON.stringify([state.index, state.replies])),
      proof_digest: sha256Hex(JSON.stringify([delivered.index, delivered.replies])),
      prefixRows,
    });
  }
  return result;
}

const STAGE_TOOLS = [
  'quarantine-cohort',
  'quarantine-cohort',
  'quarantine-cohort',
  'except-cohort',
];
const STAGE_ORDINALS = [20, 24, 30, 31];
const STAGE_PATTERNS = [
  { unsafe: 6, approved: 0, unresolved: 0 },
  { unsafe: 4, approved: 2, unresolved: 0 },
  { unsafe: 5, approved: 0, unresolved: 1 },
];

function stagedGroup(catalogs, staged) {
  const quarantine = staged.action.tool === 'quarantine-cohort';
  const catalog = quarantine
    ? catalogs.containment_cohorts.cohorts
    : catalogs.exception_bundles.bundles;
  const field = quarantine ? 'cohort_id' : 'exception_id';
  return catalog.find((entry) => entry[field] === staged.action.args[field]);
}

function assessQuarantine(staged, members, current, selected, stage) {
  const active = members.filter((key) => current.has(key));
  if (members.length !== 8 || active.length !== 6 || active.some((key) => selected.has(key))) {
    return null;
  }
  const counts = { unsafe: 0, approved: 0, unresolved: 0 };
  for (const key of active) {
    const status = staged.prefixRows[key]?.status;
    if (!Object.hasOwn(counts, status)) {
      return null;
    }
    counts[status] += 1;
  }
  if (Object.keys(counts).some((key) => counts[key] !== STAGE_PATTERNS[stage][key])) {
    return null;
  }
  const unresolvedJob =
    stage === 2
      ? active.find(
          (key) => key.startsWith('job:') && staged.prefixRows[key].status === 'unresolved',
        )
      : null;
  if (stage === 2 && !unresolvedJob) {
    return null;
  }
  return {
    active,
    approved:
      stage === 1 ? active.filter((key) => staged.prefixRows[key].status === 'approved') : [],
    unresolvedJob,
  };
}

function validException(staged, members, current, selected, approved, unresolvedJob) {
  if (staged.delivered_ordinal !== 31) {
    return false;
  }
  if (unresolvedJob && !['approved', 'unsafe'].includes(staged.prefixRows[unresolvedJob]?.status)) {
    return false;
  }
  const restored = new Set(approved);
  if (unresolvedJob && staged.prefixRows[unresolvedJob]?.status === 'approved') {
    restored.add(unresolvedJob);
  }
  const active = members.filter((key) => current.has(key) && selected.has(key));
  return active.length === restored.size && active.every((key) => restored.has(key));
}

function stagingViolations(state) {
  const current = new Set(state.index === null ? [] : Object.keys(resolvePrefix(state.index, [])));
  const selected = new Set();
  const approved = new Set();
  let unresolvedJob = null;
  let violations = Math.abs(state.staged.length - STAGE_TOOLS.length);
  for (const [stage, staged] of state.staged.slice(0, STAGE_TOOLS.length).entries()) {
    if (staged.action.tool !== STAGE_TOOLS[stage] || staged.ordinal !== STAGE_ORDINALS[stage]) {
      violations += 1;
      continue;
    }
    const group = stagedGroup(state.catalogs, staged);
    if (!group || !staged.prefixRows) {
      violations += 1;
      continue;
    }
    const members = group.selectors.map(selectorKey);
    if (stage === 3) {
      violations += Number(
        !validException(staged, members, current, selected, approved, unresolvedJob),
      );
      continue;
    }
    const assessed = assessQuarantine(staged, members, current, selected, stage);
    if (!assessed) {
      violations += 1;
      continue;
    }
    for (const key of assessed.active) {
      selected.add(key);
    }
    for (const key of assessed.approved) {
      approved.add(key);
    }
    unresolvedJob = assessed.unresolvedJob ?? unresolvedJob;
  }
  if (
    unresolvedJob &&
    (state.lastSuccessfulDetail?.tool !== 'query-workload' ||
      `job:${state.lastSuccessfulDetail.args.job_uid}` !== unresolvedJob ||
      state.lastSuccessfulDetail.ordinal !== 31)
  ) {
    violations += 1;
  }
  return violations;
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
  const deadlineViolations = stagingViolations(state);
  return {
    ...base,
    success: base.success && missing === 0 && deadlineViolations === 0,
    reason:
      base.overlapping_current_quarantines > 0
        ? 'overlapping-current-quarantines'
        : deadlineViolations > 0
          ? 'staging-deadline-violation'
          : missing > 0
            ? 'evidence-incomplete'
            : base.reason,
    missing_required_evidence_count: missing,
    staging_deadline_violations: deadlineViolations,
    staged_requests: state.staged.map(
      ({
        action,
        ordinal,
        delivered_ordinal,
        successful_detail_count,
        transcript_digest,
        proof_digest,
      }) => ({
        tool: action.tool,
        args: structuredClone(action.args),
        ordinal,
        delivered_ordinal,
        successful_detail_count,
        transcript_digest,
        proof_digest,
      }),
    ),
  };
}

function referenceRead(session, tool, args = {}) {
  const result = stepDefense(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v35 reference ${tool} failed: ${result.reason}`);
  }
  return result.evidence;
}

function referenceStage(session, action) {
  if (!action) {
    throw new Error('v35 visible prefix has no unique staged action');
  }
  const result = stepDefense(session, action);
  if (!result.ok || !result.accepted) {
    throw new Error(`v35 reference ${action.tool} failed: ${result.reason}`);
  }
}

export function referenceDefense(session) {
  const index = referenceRead(session, 'list-workloads');
  const order = solveQuerySchedule(index);
  if (order === null || order.length !== 30) {
    throw new Error('v35 visible evidence has no feasible 31-query schedule');
  }
  const catalogs = {
    containment_cohorts: session.initial.containment_cohorts,
    exception_bundles: session.initial.exception_bundles,
  };
  const replies = [];
  const selectedIds = [];
  for (const [position, entry] of order.entries()) {
    const query =
      entry.entry_type === 'credential'
        ? ['query-source', { credential_id: entry.entry_id }]
        : entry.entry_type === 'job'
          ? ['query-workload', { job_uid: entry.entry_id }]
          : ['query-session', { access_key_ref: entry.entry_id }];
    replies.push({ ok: true, evidence: referenceRead(session, ...query) });
    const ordinal = position + 2;
    if (![20, 24, 30].includes(ordinal)) {
      continue;
    }
    const rows = resolvePrefix(index, replies);
    const action = chooseStagedQuarantine(catalogs, rows, selectedIds);
    referenceStage(session, action);
    selectedIds.push(action.args.cohort_id);
  }
  referenceStage(
    session,
    chooseStagedException(catalogs, resolvePrefix(index, replies), selectedIds),
  );
  return [];
}
