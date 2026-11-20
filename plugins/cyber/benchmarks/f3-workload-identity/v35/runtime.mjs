import { replayContainment as replayV24Containment } from '../v24/runtime.mjs';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, keys) {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function selectorKey(selector) {
  if (
    !exact(selector, ['kind', 'id']) ||
    !['job', 'session'].includes(selector.kind) ||
    typeof selector.id !== 'string' ||
    !selector.id
  ) {
    throw new Error('v35 selector must have a Job or session kind and nonempty ID');
  }
  return `${selector.kind}:${selector.id}`;
}

function validateCatalog(catalog, listKey, idKey, expectedCandidates) {
  if (!record(catalog) || !Array.isArray(catalog.candidates) || !Array.isArray(catalog[listKey])) {
    throw new Error(`v35 ${listKey} catalog is missing`);
  }
  const candidates = new Set();
  for (const selector of catalog.candidates) {
    const key = selectorKey(selector);
    if (candidates.has(key)) {
      throw new Error(`v35 duplicate candidate selector ${key}`);
    }
    candidates.add(key);
  }
  if (
    expectedCandidates &&
    (candidates.size !== expectedCandidates.size ||
      [...candidates].some((key) => !expectedCandidates.has(key)))
  ) {
    throw new Error('v35 quarantine and exception candidates differ');
  }
  const groups = new Map();
  for (const group of catalog[listKey]) {
    if (
      !exact(group, [idKey, 'selectors']) ||
      typeof group[idKey] !== 'string' ||
      !group[idKey] ||
      !Array.isArray(group.selectors) ||
      group.selectors.length === 0
    ) {
      throw new Error(`v35 malformed ${listKey} group`);
    }
    if (groups.has(group[idKey])) {
      throw new Error(`v35 duplicate ${idKey} ${group[idKey]}`);
    }
    const members = new Set();
    for (const selector of group.selectors) {
      const key = selectorKey(selector);
      if (!candidates.has(key)) {
        throw new Error(`v35 ${listKey} has unknown selector ${key}`);
      }
      if (members.has(key)) {
        throw new Error(`v35 ${listKey} has duplicate selector ${key}`);
      }
      members.add(key);
    }
    groups.set(group[idKey], members);
  }
  return { candidates, groups };
}

function currentScope(native) {
  const controls = new Map();
  const issuedSessions = new Set();
  const roles = new Set();
  for (const { job_uid } of native.jobs) {
    const key = `job:${job_uid}`;
    if (controls.has(key)) {
      throw new Error(`v35 duplicate current selector ${key}`);
    }
    controls.set(key, { tool: 'pause-job', args: { job_uid } });
  }
  for (const { access_key_ref, role_arn, role_session_name } of native.sessions) {
    const key = `session:${access_key_ref}`;
    const issued = JSON.stringify([role_arn, role_session_name]);
    if (controls.has(key) || issuedSessions.has(issued)) {
      throw new Error(`v35 duplicate current session selector ${key}`);
    }
    controls.set(key, { tool: 'deny-role-session', args: { role_arn, role_session_name } });
    issuedSessions.add(issued);
    roles.add(role_arn);
  }
  return { controls, issuedSessions, roles };
}

function atomicKey(action) {
  if (action.tool === 'pause-job') {
    return `pause-job:${action.args.job_uid}`;
  }
  if (action.tool === 'deny-role-session') {
    return `deny-role-session:${JSON.stringify([action.args.role_arn, action.args.role_session_name])}`;
  }
  return `revoke-role-sessions:${action.args.role_arn}`;
}

function parseGroupAction(action, cohorts, exceptions) {
  const { args } = action;
  if (action.tool === 'quarantine-cohort') {
    if (!exact(args, ['cohort_id']) || typeof args.cohort_id !== 'string' || !args.cohort_id) {
      return { reason: 'invalid-args' };
    }
    const selectors = cohorts.get(args.cohort_id);
    return selectors
      ? { kind: 'quarantine', cohortId: args.cohort_id, selectors }
      : { reason: 'unknown-cohort' };
  }
  if (action.tool === 'except-cohort') {
    if (
      !exact(args, ['exception_id']) ||
      typeof args.exception_id !== 'string' ||
      !args.exception_id
    ) {
      return { reason: 'invalid-args' };
    }
    const selectors = exceptions.get(args.exception_id);
    return selectors ? { kind: 'exception', selectors } : { reason: 'unknown-exception' };
  }
  return null;
}

function parseDirectAction(action, scope) {
  const { args } = action;
  if (action.tool === 'pause-job') {
    if (!exact(args, ['job_uid']) || typeof args.job_uid !== 'string' || !args.job_uid) {
      return { reason: 'invalid-args' };
    }
    if (!scope.controls.has(`job:${args.job_uid}`)) {
      return { reason: 'unknown-job' };
    }
    return { kind: 'direct', action: { tool: action.tool, args: { job_uid: args.job_uid } } };
  }
  if (action.tool === 'deny-role-session') {
    if (
      !exact(args, ['role_arn', 'role_session_name']) ||
      typeof args.role_arn !== 'string' ||
      !args.role_arn ||
      typeof args.role_session_name !== 'string' ||
      !args.role_session_name
    ) {
      return { reason: 'invalid-args' };
    }
    if (!scope.issuedSessions.has(JSON.stringify([args.role_arn, args.role_session_name]))) {
      return { reason: 'unknown-issued-session' };
    }
    return {
      kind: 'direct',
      action: {
        tool: action.tool,
        args: { role_arn: args.role_arn, role_session_name: args.role_session_name },
      },
    };
  }
  if (action.tool === 'revoke-role-sessions') {
    if (!exact(args, ['role_arn']) || typeof args.role_arn !== 'string' || !args.role_arn) {
      return { reason: 'invalid-args' };
    }
    if (!scope.roles.has(args.role_arn)) {
      return { reason: 'unknown-role' };
    }
    return { kind: 'direct', action: { tool: action.tool, args: { role_arn: args.role_arn } } };
  }
  return { reason: 'unknown-tool' };
}

function parseAction(action, cohorts, exceptions, scope) {
  if (!exact(action, ['tool', 'args']) || typeof action.tool !== 'string') {
    return { reason: 'invalid-command' };
  }
  return parseGroupAction(action, cohorts, exceptions) ?? parseDirectAction(action, scope);
}

function stageQuarantine(parsed, index, scope, state, rejected) {
  if (state.selectedIds.has(parsed.cohortId)) {
    rejected.push({ index, reason: 'duplicate-quarantine' });
    return;
  }
  state.selectedIds.add(parsed.cohortId);
  let hasOverlap = false;
  for (const key of parsed.selectors) {
    state.quarantined.add(key);
    if (scope.controls.has(key)) {
      if (state.seenCurrent.has(key)) {
        state.overlappingCurrent.add(key);
        hasOverlap = true;
      }
      state.seenCurrent.add(key);
    }
  }
  if (hasOverlap) {
    rejected.push({ index, reason: 'overlapping-current-quarantines' });
  }
}

function stageActions(actions, budget, cohorts, exceptions, scope) {
  const quarantineState = {
    quarantined: new Set(),
    selectedIds: new Set(),
    seenCurrent: new Set(),
    overlappingCurrent: new Set(),
  };
  const exempted = new Set();
  const direct = new Map();
  const rejected = [];
  let exceptionCount = 0;
  for (const [index, action] of actions.entries()) {
    if (index >= budget) {
      rejected.push({ index, reason: 'action-budget-exhausted' });
      continue;
    }
    const parsed = parseAction(action, cohorts, exceptions, scope);
    if (parsed.reason) {
      rejected.push({ index, reason: parsed.reason });
      continue;
    }
    if (parsed.kind === 'exception') {
      if (exceptionCount >= 1) {
        rejected.push({ index, reason: 'exception-budget-exhausted' });
        continue;
      }
      exceptionCount += 1;
      for (const key of parsed.selectors) {
        exempted.add(key);
      }
    } else if (parsed.kind === 'quarantine') {
      stageQuarantine(parsed, index, scope, quarantineState, rejected);
    } else {
      direct.set(atomicKey(parsed.action), parsed.action);
    }
  }
  return {
    quarantined: quarantineState.quarantined,
    exempted,
    direct,
    rejected,
    overlappingCurrentQuarantines: quarantineState.overlappingCurrent.size,
  };
}

function expandControls({ quarantined, exempted, direct }, scope) {
  const expanded = new Map(direct);
  for (const key of quarantined) {
    if (!exempted.has(key)) {
      const action = scope.controls.get(key);
      if (action) {
        expanded.set(atomicKey(action), action);
      }
    }
  }
  return [...expanded]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, action]) => action);
}

/** Compose staged controls atomically, then replay their exact native effects. */
export function replayContainment(native, actions = []) {
  if (!Array.isArray(actions)) {
    throw new Error('v35 actions must be an array');
  }
  if (!Number.isSafeInteger(native?.action_budget) || native.action_budget !== 4) {
    throw new Error('v35 original request budget must be four');
  }
  const { candidates, groups: cohorts } = validateCatalog(
    native.containment_cohorts,
    'cohorts',
    'cohort_id',
  );
  const { groups: exceptions } = validateCatalog(
    native.exception_bundles,
    'bundles',
    'exception_id',
    candidates,
  );
  const scope = currentScope(native);
  for (const key of scope.controls.keys()) {
    if (!candidates.has(key)) {
      throw new Error(`v35 current selector absent from catalogs: ${key}`);
    }
  }

  const staged = stageActions(actions, native.action_budget, cohorts, exceptions, scope);
  const exactControls = expandControls(staged, scope);
  const replay = replayV24Containment(
    { ...native, action_budget: Math.max(native.action_budget, exactControls.length) },
    exactControls,
  );
  if (replay.invalid_actions !== 0) {
    throw new Error('v35 expanded action was rejected by V24 replay');
  }
  return {
    ...replay,
    success: replay.success && staged.rejected.length === 0,
    invalid_actions: staged.rejected.length,
    rejected_actions: staged.rejected,
    overlapping_current_quarantines: staged.overlappingCurrentQuarantines,
    original_request_count: actions.length,
  };
}
