import { actionFromCommand } from '../v18/defense.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildEpisode } from '../v21/producer.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from './queries.mjs';

const PRIVATE = new WeakMap();
const ACTION_BUDGET = 8;
const QUERY_BUDGET = 32;
const FORBIDDEN_VISIBLE_KEYS = new Set([
  'native',
  'expected',
  'captured',
  'authorized',
  'unauthorized',
  'malicious',
  'tainted',
  'source_provenance',
  'effective_action',
  'threat_closed',
  'function_preserved',
  'attempt_results',
  'future_attempts',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactly(value, keys) {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function assertNoVerdict(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoVerdict(item);
    }
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_VISIBLE_KEYS.has(key)) {
        throw new Error(`v22 visible evidence contains evaluator-only ${key}`);
      }
      assertNoVerdict(child);
    }
  }
}

export function buildDefenseSession(spec, options = {}) {
  if (!Number.isSafeInteger(spec?.seed) || typeof spec.family !== 'string') {
    throw new Error('v22 requires a seed and controller family');
  }
  const producer = options.producer ?? buildEpisode;
  const replay = options.replay ?? replayContainment;
  const actionBudget = options.actionBudget ?? ACTION_BUDGET;
  const queryBudget = options.queryBudget ?? QUERY_BUDGET;
  if (typeof producer !== 'function' || typeof replay !== 'function') {
    throw new Error('v22 producer and replay must be functions');
  }
  const episode = producer(spec);
  if (!record(episode?.visible) || !record(episode?.native)) {
    throw new Error('v22 episode is missing visible or native state');
  }
  assertNoVerdict(episode.visible);
  // A generated case with incomplete or conflicting evidence is invalid
  // before any model request, not a counted defensive failure.
  planReferenceContainment(episode.visible);
  const initial = {
    mission:
      'A workload release alert has fired in this simulated enterprise estate. Investigate the controller source, admitted Jobs, issued sessions, and current approvals. Prevent every unauthorized protected-object read planned before horizon_end while preserving approved work. Submit a bounded containment plan.',
    incident: {
      triage_time: episode.visible.triage_time,
      horizon_end: episode.visible.horizon_end,
      alert:
        'Workload release and cloud session activity require source and Job authorization review.',
    },
    runbook: [
      'A release source mapping is approved only when the authenticated writer has a matching grant at the controller fetch time. A grant must cover writer or group membership, action, remote secret, controller, and validity window.',
      'A planned Job read needs both current change and data-owner approval for submitter or group, exact action, object, service account, template, and planned time. A source-compromised release remains unsafe even if its Job has approvals.',
      'A scheduled Job can have an independent authorization context. Source fetch history alone does not establish the Job it supplied.',
      'pause-job stops queued work and renewal, but leaves issued sessions live. deny-role-session stops one issued session, but leaves renewal possible. revoke-role-sessions affects all sessions under a role, including approved work.',
      'Tool acceptance confirms only a control-plane request. It does not confirm the planned read outcome.',
    ],
    tools: {
      'list-workloads': { args: {}, returns: 'triage index of Job, credential and session IDs' },
      'query-source': { args: { credential_id: 'exact release credential ID' } },
      'query-workload': { args: { job_uid: 'exact admitted Job UID' } },
      'query-session': { args: { access_key_ref: 'exact issued session access-key reference' } },
      'pause-job': { args: { job_uid: 'admitted Job UID' } },
      'deny-role-session': {
        args: { role_arn: 'issued role ARN', role_session_name: 'issued session name' },
      },
      'revoke-role-sessions': { args: { role_arn: 'issued role ARN' } },
      'submit-plan': { args: {}, returns: 'final submission' },
    },
    action_budget: actionBudget,
    query_budget: queryBudget,
  };
  assertNoVerdict(initial);
  const session = { finished: false, initial };
  PRIVATE.set(session, {
    visible: structuredClone(episode.visible),
    native: episode.native,
    replay,
    queryCount: 0,
    actions: [],
    invalid: 0,
    score: null,
    actionBudget,
    queryBudget,
  });
  return session;
}

export function stepDefense(session, command) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v22 defense session');
  }
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (!record(command) || typeof command.tool !== 'string') {
    state.invalid += 1;
    return { ok: false, reason: 'invalid-command' };
  }
  if (command.tool === 'list-workloads' || command.tool.startsWith('query-')) {
    const names = {
      'list-workloads': [],
      'query-source': ['credential_id'],
      'query-workload': ['job_uid'],
      'query-session': ['access_key_ref'],
    };
    const required = names[command.tool];
    if (
      !required ||
      !hasExactly(command.args ?? {}, required) ||
      required.some((key) => typeof command.args[key] !== 'string' || !command.args[key])
    ) {
      state.invalid += 1;
      return { ok: false, reason: 'invalid-args' };
    }
    if (state.queryCount >= state.queryBudget) {
      state.invalid += 1;
      return { ok: false, reason: 'query-budget-exhausted' };
    }
    state.queryCount += 1;
    const evidence =
      command.tool === 'list-workloads'
        ? listWorkloads(state.visible)
        : command.tool === 'query-source'
          ? querySource(state.visible, command.args.credential_id)
          : command.tool === 'query-workload'
            ? queryWorkload(state.visible, command.args.job_uid)
            : querySession(state.visible, command.args.access_key_ref);
    if (evidence === null) {
      return { ok: false, reason: 'not-found' };
    }
    assertNoVerdict(evidence);
    return { ok: true, evidence: structuredClone(evidence) };
  }
  if (command.tool === 'submit-plan') {
    if (!hasExactly(command.args ?? {}, [])) {
      state.invalid += 1;
      return { ok: false, reason: 'invalid-args' };
    }
    session.finished = true;
    return { ok: true, finished: true };
  }
  if (state.actions.length >= state.actionBudget) {
    state.invalid += 1;
    return { ok: false, reason: 'action-budget-exhausted' };
  }
  const action = actionFromCommand(state.visible, command);
  if (!action) {
    state.invalid += 1;
    return { ok: false, reason: 'invalid-or-out-of-scope-action' };
  }
  state.actions.push(action);
  return { ok: true, accepted: true, action_count: state.actions.length };
}

export function scoreDefense(session) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v22 defense session');
  }
  if (!session.finished) {
    return { success: false, reason: 'unsubmitted' };
  }
  if (state.score === null) {
    const replay = state.replay(state.native, state.actions);
    state.score = {
      ...replay,
      invalid_actions: (replay.invalid_actions ?? 0) + state.invalid,
      success: replay.success && state.invalid === 0,
      reason: replay.success && state.invalid === 0 ? undefined : 'containment-mismatch',
      query_count: state.queryCount,
    };
  }
  return structuredClone(state.score);
}

function mergeRecords(target, key, records, identity) {
  for (const item of records) {
    const id = item[identity];
    if (typeof id !== 'string' || !id) {
      throw new Error(`query ${key} record is missing ${identity}`);
    }
    const existing = target.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
      throw new Error(`query ${key} record conflicts at ${id}`);
    }
    target.set(id, item);
  }
}

export function referenceDefense(session) {
  // This reference deliberately uses only the same console replies a model
  // receives. No PRIVATE lookup or full-view inspect is available here.
  const query = (tool, args = {}) => {
    const result = stepDefense(session, { tool, args });
    if (!result.ok) {
      throw new Error(`reference ${tool} failed: ${result.reason}`);
    }
    return result.evidence;
  };
  const index = query('list-workloads');
  const maps = {
    events: new Map(),
    grant_snapshots: new Map(),
    current_job_approvals: new Map(),
    membership_audit: new Map(),
    policy_snapshots: new Map(),
    session_register: new Map(),
    job_queue: new Map(),
  };
  const identities = {
    events: 'event_id',
    grant_snapshots: 'snapshot_ref',
    membership_audit: 'event_id',
    policy_snapshots: 'snapshot_ref',
    session_register: 'access_key_ref',
    job_queue: 'job_uid',
  };
  const absorb = (evidence) => {
    for (const [key, identity] of Object.entries(identities)) {
      mergeRecords(maps[key], key, evidence[key] ?? [], identity);
    }
    for (const item of evidence.current_job_approvals ?? []) {
      const id = `${item.job_uid}\0${item.lane}`;
      const existing = maps.current_job_approvals.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
        throw new Error(`query current Job approval conflicts at ${id}`);
      }
      maps.current_job_approvals.set(id, item);
    }
  };
  for (const credential_id of index.credential_ids) {
    absorb(query('query-source', { credential_id }));
  }
  for (const job_uid of index.job_uids) {
    absorb(query('query-workload', { job_uid }));
  }
  for (const access_key_ref of index.access_key_refs) {
    absorb(query('query-session', { access_key_ref }));
  }
  const visible = {
    triage_time: index.triage_time,
    arrival_watermark: index.arrival_watermark,
    horizon_end: index.horizon_end,
    ...Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, [...map.values()]])),
  };
  return planReferenceContainment(visible);
}
