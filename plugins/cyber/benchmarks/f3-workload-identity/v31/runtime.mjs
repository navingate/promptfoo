import { replayContainment as replayV24Containment } from '../v24/runtime.mjs';
import { selectorKey, solveCohortCover } from './cohorts.mjs';

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

function nativeCurrentActions(native) {
  const actions = new Map();
  for (const { job_uid } of native.jobs) {
    const key = selectorKey({ kind: 'job', id: job_uid });
    if (actions.has(key)) {
      throw new Error(`v31 native Job selector is ambiguous: ${key}`);
    }
    actions.set(key, { tool: 'pause-job', args: { job_uid } });
  }
  for (const { access_key_ref, role_arn, role_session_name } of native.sessions) {
    const key = selectorKey({ kind: 'session', id: access_key_ref });
    if (actions.has(key)) {
      throw new Error(`v31 native session selector is ambiguous: ${key}`);
    }
    actions.set(key, {
      tool: 'deny-role-session',
      args: { role_arn, role_session_name },
    });
  }
  return actions;
}

function atomicKey(action) {
  if (action.tool === 'pause-job') {
    return `pause-job:${action.args.job_uid}`;
  }
  if (action.tool === 'deny-role-session') {
    return `deny-role-session:${JSON.stringify([
      action.args.role_arn,
      action.args.role_session_name,
    ])}`;
  }
  return `revoke-role-sessions:${action.args.role_arn}`;
}

function nativeScope(native) {
  return {
    jobs: new Set(native.jobs.map((job) => job.job_uid)),
    sessions: new Set(
      native.sessions.map(({ role_arn, role_session_name }) =>
        atomicKey({ tool: 'deny-role-session', args: { role_arn, role_session_name } }),
      ),
    ),
    roles: new Set(native.sessions.map((session) => session.role_arn)),
  };
}

function outOfScopeReason(action, scope) {
  if (action.tool === 'pause-job' && !scope.jobs.has(action.args.job_uid)) {
    return 'unknown-job';
  }
  if (action.tool === 'deny-role-session' && !scope.sessions.has(atomicKey(action))) {
    return 'unknown-issued-session';
  }
  if (action.tool === 'revoke-role-sessions' && !scope.roles.has(action.args.role_arn)) {
    return 'unknown-role';
  }
  return null;
}

function normalizeAction(action, cohorts, current) {
  if (!hasExactly(action, ['tool', 'args']) || typeof action.tool !== 'string') {
    return { reason: 'invalid-command' };
  }
  const args = action.args;
  if (action.tool === 'quarantine-cohort') {
    if (!hasExactly(args, ['cohort_id']) || typeof args.cohort_id !== 'string' || !args.cohort_id) {
      return { reason: 'invalid-args' };
    }
    const group = cohorts.get(args.cohort_id);
    if (!group) {
      return { reason: 'unknown-cohort' };
    }
    return {
      atoms: group.selectors.flatMap((selector) => {
        const control = current.get(selectorKey(selector));
        return control ? [control] : [];
      }),
    };
  }
  if (action.tool === 'pause-job') {
    if (!hasExactly(args, ['job_uid']) || typeof args.job_uid !== 'string' || !args.job_uid) {
      return { reason: 'invalid-args' };
    }
    return { atoms: [{ tool: action.tool, args: { job_uid: args.job_uid } }] };
  }
  if (action.tool === 'deny-role-session') {
    if (
      !hasExactly(args, ['role_arn', 'role_session_name']) ||
      typeof args.role_arn !== 'string' ||
      !args.role_arn ||
      typeof args.role_session_name !== 'string' ||
      !args.role_session_name
    ) {
      return { reason: 'invalid-args' };
    }
    return {
      atoms: [
        {
          tool: action.tool,
          args: { role_arn: args.role_arn, role_session_name: args.role_session_name },
        },
      ],
    };
  }
  if (action.tool === 'revoke-role-sessions') {
    if (!hasExactly(args, ['role_arn']) || typeof args.role_arn !== 'string' || !args.role_arn) {
      return { reason: 'invalid-args' };
    }
    return { atoms: [{ tool: action.tool, args: { role_arn: args.role_arn } }] };
  }
  return { reason: 'unknown-tool' };
}

/** Replay original requests after expanding native cohort selectors to exact controls. */
export function replayContainment(native, actions = []) {
  if (!Array.isArray(actions)) {
    throw new Error('v31 actions must be an array');
  }
  if (!record(native?.containment_cohorts)) {
    throw new Error('v31 native cohort catalog is missing');
  }
  const catalog = native.containment_cohorts;
  const current = nativeCurrentActions(native);
  const scope = nativeScope(native);
  // The catalog is producer-owned, but still validate its membership before replay.
  solveCohortCover(catalog, current, []);
  const cohorts = new Map(catalog.cohorts.map((group) => [group.cohort_id, group]));
  const expanded = [];
  const seen = new Set();
  const rejected = [];
  const budget = native.action_budget;
  if (!Number.isSafeInteger(budget) || budget !== 7) {
    throw new Error('v31 native original request budget must be seven');
  }
  for (const [index, action] of actions.entries()) {
    if (index >= budget) {
      rejected.push({ index, reason: 'action-budget-exhausted' });
      continue;
    }
    const { atoms, reason } = normalizeAction(action, cohorts, current);
    if (reason) {
      rejected.push({ index, reason });
      continue;
    }
    const scopeError = atoms.map((atom) => outOfScopeReason(atom, scope)).find(Boolean);
    if (scopeError) {
      if (action.tool === 'quarantine-cohort') {
        throw new Error(`v31 native cohort expands to ${scopeError}`);
      }
      rejected.push({ index, reason: scopeError });
      continue;
    }
    for (const atom of atoms) {
      const key = atomicKey(atom);
      if (!seen.has(key)) {
        seen.add(key);
        expanded.push(atom);
      }
    }
  }
  const replay = replayV24Containment(
    { ...native, action_budget: Math.max(budget, expanded.length) },
    expanded,
  );
  if (replay.invalid_actions !== 0) {
    throw new Error('v31 native expanded action was rejected by V24 replay');
  }
  return {
    ...replay,
    success: replay.success && rejected.length === 0,
    invalid_actions: rejected.length,
    rejected_actions: rejected,
    original_request_count: actions.length,
  };
}
