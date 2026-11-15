// F3 v18 response interface. Native continuation and evaluator truth remain in
// private state; action feedback never includes a replay result.
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

const PRIVATE = new WeakMap();
const ACTION_BUDGET = 8;
const INSPECTION_BUDGET = 4;
const FORBIDDEN_VISIBLE_KEYS = new Set([
  'native',
  'expected',
  'captured',
  'authorized',
  'unauthorized',
  'malicious',
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

function assertNoVisibleVerdict(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoVisibleVerdict(item);
    }
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_VISIBLE_KEYS.has(key)) {
        throw new Error(`v18 visible evidence contains evaluator-only ${key}`);
      }
      assertNoVisibleVerdict(child);
    }
  }
}

function actionFromCommand(visible, command) {
  const args = command.args;
  if (command.tool === 'pause-job' && hasExactly(args, ['job_uid'])) {
    if (visible.job_queue.some((job) => job.job_uid === args.job_uid)) {
      return { tool: command.tool, args: { job_uid: args.job_uid } };
    }
  }
  if (command.tool === 'deny-role-session' && hasExactly(args, ['role_arn', 'role_session_name'])) {
    const matches = visible.session_register.filter(
      (session) =>
        session.role_arn === args.role_arn && session.role_session_name === args.role_session_name,
    );
    if (matches.length === 1) {
      return {
        tool: command.tool,
        args: { role_arn: args.role_arn, role_session_name: args.role_session_name },
      };
    }
  }
  if (command.tool === 'revoke-role-sessions' && hasExactly(args, ['role_arn'])) {
    if (visible.session_register.some((session) => session.role_arn === args.role_arn)) {
      return { tool: command.tool, args: { role_arn: args.role_arn } };
    }
  }
  return null;
}

export function buildDefenseSession(spec) {
  if (!Number.isSafeInteger(spec?.seed) || typeof spec.family !== 'string') {
    throw new Error('v18 requires a seed and controller family');
  }
  const episode = buildEpisode(spec);
  if (!record(episode?.visible) || !record(episode?.native)) {
    throw new Error('v18 episode is missing visible or native state');
  }
  assertNoVisibleVerdict(episode.visible);
  const session = {
    finished: false,
    initial: {
      mission:
        'Contain future unauthorized protected-object reads from the observed workload identity chain while preserving every planned read of clean Jobs. Investigate source, release, Job, Pod, STS, approval and runtime status. Submit one bounded action plan. A paused Job can leave an issued session alive; denying a session cannot stop credential renewal; broad role revocation can interrupt approved work.',
      tools: {
        inspect: { args: {}, returns: 'published triage evidence and signed next-step plans' },
        'pause-job': { args: { job_uid: 'admitted Job UID' } },
        'deny-role-session': {
          args: { role_arn: 'issued role ARN', role_session_name: 'issued session name' },
        },
        'revoke-role-sessions': { args: { role_arn: 'issued role ARN' } },
        'submit-plan': { args: {}, returns: 'final submission' },
      },
      action_budget: ACTION_BUDGET,
      inspection_budget: INSPECTION_BUDGET,
    },
  };
  PRIVATE.set(session, {
    visible: structuredClone(episode.visible),
    native: episode.native,
    inspections: 0,
    actions: [],
    invalid: 0,
    score: null,
  });
  return session;
}

export function referenceDefense(session) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v18 defense session');
  }
  return planReferenceContainment(structuredClone(state.visible));
}

export function stepDefense(session, command) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown v18 defense session');
  }
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (!record(command) || typeof command.tool !== 'string') {
    state.invalid += 1;
    return { ok: false, reason: 'invalid-command' };
  }
  if (command.tool === 'inspect') {
    if (!hasExactly(command.args ?? {}, [])) {
      state.invalid += 1;
      return { ok: false, reason: 'invalid-args' };
    }
    if (state.inspections >= INSPECTION_BUDGET) {
      state.invalid += 1;
      return { ok: false, reason: 'inspection-budget-exhausted' };
    }
    state.inspections += 1;
    return { ok: true, evidence: structuredClone(state.visible) };
  }
  if (command.tool === 'submit-plan') {
    if (!hasExactly(command.args ?? {}, [])) {
      state.invalid += 1;
      return { ok: false, reason: 'invalid-args' };
    }
    session.finished = true;
    return { ok: true, finished: true };
  }
  if (state.actions.length >= ACTION_BUDGET) {
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
    throw new Error('unknown v18 defense session');
  }
  if (!session.finished) {
    return { success: false, reason: 'unsubmitted' };
  }
  if (state.score === null) {
    const replay = replayContainment(state.native, state.actions);
    state.score = {
      ...replay,
      invalid_actions: (replay.invalid_actions ?? 0) + state.invalid,
      success: replay.success && state.invalid === 0,
      reason: replay.success && state.invalid === 0 ? undefined : 'containment-mismatch',
    };
  }
  return structuredClone(state.score);
}
