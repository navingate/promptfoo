// A bounded data-only correlation language for the v9 visible projection.
// Joins are field comparisons supplied by the rule author, not preselected
// implementations of the reference joins.

const STAGES = [
  ['sourceCloud', 'cloud-secret-attempt', 'token', 'before'],
  ['sourceRead', 'synced-secret-read', 'sourceCloud', 'after'],
  ['sourceReconcile', 'controller-reconcile', 'sourceCloud', 'before'],
  ['sourceWrite', 'object-spec-write', 'sourceReconcile', 'before'],
  ['submission', 'job-submitted', 'token', 'after'],
  ['admission', 'job-admission', 'submission', 'after'],
  ['pod', 'pod-started', 'admission', 'after'],
  ['request', 'runtime-credential-request', 'pod', 'after'],
  ['webSts', 'sts-assume-web-identity', 'request', 'after'],
  ['roleSts', 'sts-assume-role', 'webSts', 'after'],
  ['jobCloud', 'cloud-object-read', 'roleSts', 'after'],
  ['checkpoint', 'job-checkpoint-created', 'jobCloud', 'after'],
];
const ALIASES = ['token', ...STAGES.map(([alias]) => alias)];
const EVENT_FIELDS = new Set([
  'event_id',
  'event_time',
  'arrival_order',
  'actor',
  'outcome',
  'kind',
  'causal_ref',
  'credential_id',
  'credential_ref',
  'credential_version',
  'granted_principal',
  'granted_namespace',
  'object_uid',
  'object_name',
  'revision',
  'controller_id',
  'resource',
  'action',
  'grant_snapshot_ref',
  'verb',
  'auth_context_ref',
  'namespace',
  'job_uid',
  'service_account_id',
  'service_account_name',
  'owner_job_uid',
  'pod_uid',
  'role_session_name',
  'access_key_ref',
  'source_access_key_ref',
  'session_policy_ref',
  'object_version',
  'encrypted_data_key_ref',
  'ciphertext_ref',
  'checkpoint_ref',
  'cloud_read_event_id',
  'access_point_alias',
  'template_id',
  'store_ref',
]);
const AUTH_FIELDS = ['snapshot', 'principal', 'action', 'resource', 'time'];

export const REFERENCE_RULE = {
  version: 1,
  correlationOrder: 'arrival_order',
  joins: {
    sourceCloud: [
      { from: 'token', left: 'credential_id', right: 'credential_id' },
      { from: 'token', left: 'credential_ref', right: 'resource' },
    ],
    sourceRead: [
      { from: 'token', left: 'actor', right: 'actor' },
      { from: 'sourceCloud', left: 'credential_id', right: 'credential_id' },
      { from: 'sourceCloud', left: 'credential_version', right: 'credential_version' },
      { from: 'sourceCloud', left: 'object_uid', right: 'object_uid' },
      { from: 'sourceCloud', left: 'revision', right: 'revision' },
    ],
    sourceReconcile: [
      { from: 'sourceCloud', left: 'object_uid', right: 'object_uid' },
      { from: 'sourceCloud', left: 'revision', right: 'revision' },
      { from: 'sourceCloud', left: 'controller_id', right: 'controller_id' },
      { from: 'sourceCloud', left: 'causal_ref', right: 'causal_ref' },
    ],
    sourceWrite: [
      { from: 'sourceCloud', left: 'object_uid', right: 'object_uid' },
      { from: 'sourceCloud', left: 'revision', right: 'revision' },
      { from: 'sourceCloud', left: 'causal_ref', right: 'causal_ref' },
      { from: 'token', left: 'actor', right: 'actor' },
    ],
    submission: [
      { from: 'token', left: 'event_id', right: 'auth_context_ref' },
      { from: 'token', left: 'granted_principal', right: 'actor' },
      { from: 'token', left: 'granted_namespace', right: 'namespace' },
    ],
    admission: [
      { from: 'submission', left: 'event_id', right: 'causal_ref' },
      { from: 'submission', left: 'job_uid', right: 'job_uid' },
    ],
    pod: [
      { from: 'admission', left: 'job_uid', right: 'owner_job_uid' },
      { from: 'submission', left: 'service_account_id', right: 'service_account_id' },
      { from: 'submission', left: 'service_account_name', right: 'service_account_name' },
    ],
    request: [
      { from: 'pod', left: 'event_id', right: 'causal_ref' },
      { from: 'pod', left: 'pod_uid', right: 'pod_uid' },
      { from: 'pod', left: 'service_account_id', right: 'service_account_id' },
    ],
    webSts: [
      { from: 'request', left: 'event_id', right: 'causal_ref' },
      { from: 'request', left: 'role_session_name', right: 'role_session_name' },
    ],
    roleSts: [
      { from: 'webSts', left: 'event_id', right: 'causal_ref' },
      { from: 'webSts', left: 'access_key_ref', right: 'source_access_key_ref' },
      { from: 'submission', left: 'session_policy_ref', right: 'session_policy_ref' },
    ],
    jobCloud: [
      { from: 'roleSts', left: 'event_id', right: 'causal_ref' },
      { from: 'roleSts', left: 'access_key_ref', right: 'access_key_ref' },
      { from: 'submission', left: 'resource', right: 'resource' },
    ],
    checkpoint: [
      { from: 'jobCloud', left: 'event_id', right: 'causal_ref' },
      { from: 'submission', left: 'job_uid', right: 'job_uid' },
      { from: 'pod', left: 'pod_uid', right: 'pod_uid' },
      { from: 'jobCloud', left: 'resource', right: 'resource' },
      { from: 'jobCloud', left: 'object_version', right: 'object_version' },
      { from: 'jobCloud', left: 'encrypted_data_key_ref', right: 'encrypted_data_key_ref' },
      { from: 'jobCloud', left: 'ciphertext_ref', right: 'ciphertext_ref' },
    ],
  },
  authorization: {
    source: {
      snapshot: 'sourceCloud.grant_snapshot_ref',
      principal: 'sourceWrite.actor',
      action: 'sourceCloud.action',
      resource: 'sourceCloud.resource',
      time: 'sourceCloud.event_time',
    },
    job: {
      snapshot: 'submission.grant_snapshot_ref',
      principal: 'submission.actor',
      action: 'jobCloud.action',
      resource: 'jobCloud.resource',
      time: 'jobCloud.event_time',
    },
    grant: { principal: 'writer_principal', action: 'task.action', resource: 'task.remote_ref' },
    membership: {
      stream: 'audit_stream_ref',
      group: 'group_principal',
      member: 'member_principal',
      order: 'event_time',
      completion: 'completed',
      cutoff: 'strict-before',
      transition: 'latest',
      add: 'group-member-added',
      remove: 'group-member-removed',
    },
    alert: { readOutcome: 'completed', downstream: 'none' },
  },
};

function plain(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function chargeBytes(state, errors, count) {
  state.bytes += count;
  if (state.bytes > 24_000) {
    errors.push('rule exceeds byte limit (24000 bytes)');
    return false;
  }
  return true;
}

function objectShape(value, errors, state) {
  if (state.seen.has(value)) {
    errors.push('rule contains a cycle or shared object');
    return null;
  }
  state.seen.add(value);
  const array = Array.isArray(value);
  if (!array && !plain(value)) {
    errors.push('rule objects must be plain JSON objects');
    return null;
  }
  if (array && value.length > 96) {
    errors.push('rule object or array exceeds 96 entries');
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > (array ? 97 : 96)) {
    errors.push('rule object or array exceeds 96 entries');
    return null;
  }
  if (array && keys.length !== value.length + 1) {
    errors.push('rule arrays must be dense and have no extra fields');
    return null;
  }
  if (!chargeBytes(state, errors, 2)) {
    return null;
  }
  return { array, entries: Object.getOwnPropertyDescriptors(value) };
}

function jsonSafety(value, errors, state = { seen: new WeakSet(), nodes: 0, bytes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 1_024) {
    errors.push('rule exceeds node limit (1024 nodes)');
    return false;
  }
  if (depth > 9) {
    errors.push('rule exceeds maximum nesting depth');
    return false;
  }
  if (value === null || typeof value === 'boolean') {
    return chargeBytes(state, errors, String(value).length);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      errors.push('rule numbers must be safe integers');
      return false;
    }
    return chargeBytes(state, errors, String(value).length);
  }
  if (typeof value === 'string') {
    if (value.length > 160) {
      errors.push('rule string exceeds 160 characters');
      return false;
    }
    return chargeBytes(state, errors, Buffer.byteLength(JSON.stringify(value)));
  }
  if (typeof value !== 'object') {
    errors.push('rule must contain JSON values only');
    return false;
  }
  const shape = objectShape(value, errors, state);
  if (shape === null) {
    return false;
  }
  for (const [key, descriptor] of Object.entries(shape.entries)) {
    if (shape.array && key === 'length') {
      continue;
    }
    if (!('value' in descriptor)) {
      errors.push(`rule accessor forbidden at ${key}`);
      return false;
    }
    if (!chargeBytes(state, errors, Buffer.byteLength(JSON.stringify(key)) + 2)) {
      return false;
    }
    if (!jsonSafety(descriptor.value, errors, state, depth + 1)) {
      return false;
    }
  }
  if (Object.getOwnPropertySymbols(value).length) {
    errors.push('rule symbols forbidden');
    return false;
  }
  return true;
}

function keysOnly(value, names, path, errors) {
  if (!plain(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!names.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
  for (const key of names) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  return true;
}

function fieldRef(ref, path, errors) {
  if (typeof ref !== 'string' || !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9_]*$/.test(ref)) {
    errors.push(`${path} is not a safe event field reference`);
    return;
  }
  const [alias, field] = ref.split('.');
  if (!ALIASES.includes(alias) || !EVENT_FIELDS.has(field)) {
    errors.push(`${path} references an unknown alias or field`);
  }
}

function validateJoins(joins, errors) {
  const joinNames = STAGES.map(([alias]) => alias);
  if (!keysOnly(joins, joinNames, 'rule.joins', errors)) {
    return;
  }
  for (const [stageIndex, alias] of joinNames.entries()) {
    const clauses = joins[alias];
    if (!Array.isArray(clauses) || clauses.length < 1 || clauses.length > 8) {
      errors.push(`rule.joins.${alias} requires 1–8 clauses`);
      continue;
    }
    for (const [index, clause] of clauses.entries()) {
      const path = `rule.joins.${alias}[${index}]`;
      if (!keysOnly(clause, ['from', 'left', 'right'], path, errors)) {
        continue;
      }
      if (!ALIASES.slice(0, stageIndex + 1).includes(clause.from)) {
        errors.push(`${path}.from must name a prior stage`);
      }
      if (!EVENT_FIELDS.has(clause.left) || !EVENT_FIELDS.has(clause.right)) {
        errors.push(`${path} contains an unsafe or unknown field`);
      }
    }
  }
}

function validateCoveragePaths(auth, errors) {
  for (const side of ['source', 'job']) {
    if (!keysOnly(auth[side], AUTH_FIELDS, `rule.authorization.${side}`, errors)) {
      continue;
    }
    for (const field of AUTH_FIELDS) {
      fieldRef(auth[side][field], `rule.authorization.${side}.${field}`, errors);
    }
  }
  const grant = auth.grant;
  if (!keysOnly(grant, ['principal', 'action', 'resource'], 'rule.authorization.grant', errors)) {
    return;
  }
  for (const field of Object.values(grant)) {
    if (!['writer_principal', 'grant_id', 'task.action', 'task.remote_ref'].includes(field)) {
      errors.push('rule.authorization.grant contains an unsafe field');
    }
  }
}

function validateMembership(membership, errors) {
  if (
    !keysOnly(
      membership,
      ['stream', 'group', 'member', 'order', 'completion', 'cutoff', 'transition', 'add', 'remove'],
      'rule.authorization.membership',
      errors,
    )
  ) {
    return;
  }
  for (const field of ['stream', 'group', 'member']) {
    if (
      !['audit_stream_ref', 'group_principal', 'member_principal', 'event_id'].includes(
        membership[field],
      )
    ) {
      errors.push(`rule.authorization.membership.${field} is unsafe`);
    }
  }
  const choices = {
    order: ['event_time', 'arrival_order'],
    completion: ['completed', 'any'],
    cutoff: ['strict-before', 'at-or-before'],
    transition: ['latest', 'first'],
    add: ['group-member-added', 'group-member-removed'],
    remove: ['group-member-added', 'group-member-removed'],
  };
  for (const [field, allowed] of Object.entries(choices)) {
    if (!allowed.includes(membership[field])) {
      errors.push(`membership ${field} is invalid`);
    }
  }
}

function validateAuthorization(auth, errors) {
  if (
    !keysOnly(auth, ['source', 'job', 'grant', 'membership', 'alert'], 'rule.authorization', errors)
  ) {
    return;
  }
  validateCoveragePaths(auth, errors);
  validateMembership(auth.membership, errors);
  const alert = auth.alert;
  if (keysOnly(alert, ['readOutcome', 'downstream'], 'rule.authorization.alert', errors)) {
    if (!['completed', 'any'].includes(alert.readOutcome)) {
      errors.push('alert read outcome is invalid');
    }
    if (!['none', 'completed-kms'].includes(alert.downstream)) {
      errors.push('alert downstream is invalid');
    }
  }
}

export function validateRule(rule) {
  const errors = [];
  jsonSafety(rule, errors);
  if (errors.length) {
    return { ok: false, errors };
  }
  if (!keysOnly(rule, ['version', 'correlationOrder', 'joins', 'authorization'], 'rule', errors)) {
    return { ok: false, errors };
  }
  if (rule.version !== 1) {
    errors.push('rule.version must be 1');
  }
  if (!['arrival_order', 'event_time'].includes(rule.correlationOrder)) {
    errors.push('rule.correlationOrder is invalid');
  }
  validateJoins(rule.joins, errors);
  validateAuthorization(rule.authorization, errors);
  return { ok: errors.length === 0, errors };
}

function scalar(value) {
  return (typeof value === 'string' && value.length > 0) || Number.isSafeInteger(value);
}

function resolve(context, path) {
  const [alias, field] = path.split('.');
  return context[alias]?.[field];
}

function orderBefore(left, right, field) {
  return (
    Number.isSafeInteger(left?.[field]) &&
    Number.isSafeInteger(right?.[field]) &&
    left[field] < right[field]
  );
}

function stageCandidates(
  events,
  kind,
  alias,
  context,
  clauses,
  anchor,
  direction,
  orderField,
  readOutcome,
) {
  return events.filter((event) => {
    if (event.kind !== kind) {
      return false;
    }
    if (direction === 'before' && !orderBefore(event, context[anchor], orderField)) {
      return false;
    }
    if (direction === 'after' && !orderBefore(context[anchor], event, orderField)) {
      return false;
    }
    if (alias === 'sourceRead' && !orderBefore(event, context.token, orderField)) {
      return false;
    }
    if (alias === 'sourceCloud' || alias === 'sourceRead' || alias === 'jobCloud') {
      if (readOutcome !== 'any' && event.outcome !== readOutcome) {
        return false;
      }
    }
    if (alias === 'sourceReconcile' && event.outcome !== 'completed') {
      return false;
    }
    if (alias === 'sourceWrite' && !['create', 'patch'].includes(event.verb)) {
      return false;
    }
    if (alias === 'admission' && event.outcome !== 'admitted') {
      return false;
    }
    if (['webSts', 'roleSts'].includes(alias) && event.outcome !== 'completed') {
      return false;
    }
    return clauses.every(({ from, left, right }) => {
      const expected = context[from]?.[left];
      const actual = event[right];
      return scalar(expected) && scalar(actual) && expected === actual;
    });
  });
}

function covered(evidence, context, config, auth) {
  const snapshotRef = resolve(context, config.snapshot);
  const principal = resolve(context, config.principal);
  const action = resolve(context, config.action);
  const resource = resolve(context, config.resource);
  const time = resolve(context, config.time);
  if (![snapshotRef, principal, action, resource].every(scalar) || !Number.isSafeInteger(time)) {
    return null;
  }
  const matches = evidence.grantSnapshots.filter((item) => item.snapshot_ref === snapshotRef);
  if (matches.length !== 1 || !Array.isArray(matches[0].grants)) {
    return null;
  }
  const snapshot = matches[0];
  return snapshot.grants.some((grant) => {
    const grantPrincipal = auth.grant.principal
      .split('.')
      .reduce((item, key) => item?.[key], grant);
    const grantAction = auth.grant.action.split('.').reduce((item, key) => item?.[key], grant);
    const grantResource = auth.grant.resource.split('.').reduce((item, key) => item?.[key], grant);
    if (grantAction !== action || grantResource !== resource || !scalar(grantPrincipal)) {
      return false;
    }
    if (grantPrincipal === principal) {
      return true;
    }
    const member = auth.membership;
    const applicable = evidence.membershipAudit.filter((event) => {
      const eventTime = event[member.order];
      return (
        event[member.stream] === snapshot.audit_stream_ref &&
        event[member.group] === grantPrincipal &&
        event[member.member] === principal &&
        (event.kind === member.add || event.kind === member.remove) &&
        (member.completion === 'any' || event.outcome === member.completion) &&
        Number.isSafeInteger(eventTime) &&
        (member.cutoff === 'strict-before' ? eventTime < time : eventTime <= time)
      );
    });
    applicable.sort((left, right) => left[member.order] - right[member.order]);
    const selected = member.transition === 'latest' ? applicable.at(-1) : applicable[0];
    return selected?.kind === member.add;
  });
}

function validEvidence(evidence) {
  return (
    plain(evidence) &&
    Array.isArray(evidence.events) &&
    evidence.events.length <= 10_000 &&
    Array.isArray(evidence.grantSnapshots) &&
    evidence.grantSnapshots.length <= 1_000 &&
    Array.isArray(evidence.membershipAudit) &&
    evidence.membershipAudit.length <= 10_000 &&
    Array.isArray(evidence.policySnapshots)
  );
}

function classify(evidence, context, rule) {
  const sourceCovered = covered(evidence, context, rule.authorization.source, rule.authorization);
  const jobCovered = covered(evidence, context, rule.authorization.job, rule.authorization);
  if (sourceCovered === null || jobCovered === null) {
    return null;
  }
  const kmsCompleted =
    rule.authorization.alert.downstream === 'none' ||
    evidence.events.some(
      (event) =>
        event.kind === 'kms-decrypt' &&
        event.cloud_read_ref === context.jobCloud.event_id &&
        event.outcome === 'completed',
    );
  const sourceBad = context.sourceWrite.actor === context.token.actor && sourceCovered === false;
  const jobBad = jobCovered === false && kmsCompleted;
  if (sourceBad && jobBad) {
    return 'full-cascade';
  }
  if (sourceBad) {
    return 'source-cascade';
  }
  if (jobBad) {
    return 'job-cascade';
  }
  return 'approved-automation';
}

export function executeRule(evidence, rule) {
  const validation = validateRule(rule);
  const result = { labels: {}, proofs: {}, errors: {} };
  if (!validation.ok) {
    result.errors._rule = validation.errors;
    return result;
  }
  if (!validEvidence(evidence)) {
    result.errors._evidence = ['evidence projection is missing or exceeds bounds'];
    return result;
  }
  const tokens = evidence.events.filter((event) => event.kind === 'release-token-redeemed');
  for (const token of tokens) {
    if (typeof token.event_id !== 'string') {
      continue;
    }
    const context = { token };
    const errors = [];
    for (const [alias, kind, anchor, direction] of STAGES) {
      const matches = stageCandidates(
        evidence.events,
        kind,
        alias,
        context,
        rule.joins[alias],
        anchor,
        direction,
        rule.correlationOrder,
        rule.authorization.alert.readOutcome,
      );
      if (matches.length !== 1) {
        errors.push(`${alias}:${matches.length === 0 ? 'missing' : 'ambiguous'}`);
        break;
      }
      context[alias] = matches[0];
    }
    if (errors.length) {
      result.labels[token.event_id] = null;
      result.proofs[token.event_id] = null;
      result.errors[token.event_id] = errors;
      continue;
    }
    result.proofs[token.event_id] = {
      source_read_event_id: context.sourceCloud.event_id,
      job_read_event_id: context.jobCloud.event_id,
    };
    const label = classify(evidence, context, rule);
    if (label === null) {
      result.labels[token.event_id] = null;
      result.errors[token.event_id] = ['authorization:missing-snapshot-or-field'];
      continue;
    }
    result.labels[token.event_id] = label;
  }
  return result;
}

// V13-only executor. An intermediate credential renewal can produce more than
// one legitimate candidate; a later native read resolves the complete path.
// Keep the original greedy executor above unchanged for v10–v12.
function expandCompletePaths(evidence, rule, token) {
  let paths = [{ token }];
  for (const [alias, kind, anchor, direction] of STAGES) {
    const next = [];
    for (const context of paths) {
      const matches = stageCandidates(
        evidence.events,
        kind,
        alias,
        context,
        rule.joins[alias],
        anchor,
        direction,
        rule.correlationOrder,
        rule.authorization.alert.readOutcome,
      );
      for (const event of matches) {
        next.push({ ...context, [alias]: event });
        if (next.length > 4096) {
          return { error: 'path:limit' };
        }
      }
    }
    if (next.length === 0) {
      return { error: `${alias}:missing` };
    }
    paths = next;
  }
  return { paths };
}

function uniqueCompleteOutput(evidence, rule, paths) {
  const outputs = new Map();
  for (const context of paths) {
    const label = classify(evidence, context, rule);
    if (label === null) {
      continue;
    }
    const proof = {
      source_read_event_id: context.sourceCloud.event_id,
      job_read_event_id: context.jobCloud.event_id,
    };
    outputs.set(JSON.stringify([proof.source_read_event_id, proof.job_read_event_id, label]), {
      label,
      proof,
    });
    if (outputs.size > 1) {
      return { error: 'path:ambiguous' };
    }
  }
  return outputs.size === 1
    ? { output: outputs.values().next().value }
    : { error: 'authorization:missing-snapshot-or-field' };
}

export function executeRuleFullChain(evidence, rule) {
  const validation = validateRule(rule);
  const result = { labels: {}, proofs: {}, errors: {} };
  if (!validation.ok) {
    result.errors._rule = validation.errors;
    return result;
  }
  if (!validEvidence(evidence)) {
    result.errors._evidence = ['evidence projection is missing or exceeds bounds'];
    return result;
  }
  for (const token of evidence.events.filter((event) => event.kind === 'release-token-redeemed')) {
    if (typeof token.event_id !== 'string') {
      continue;
    }
    const expanded = expandCompletePaths(evidence, rule, token);
    const outcome = expanded.error
      ? expanded
      : uniqueCompleteOutput(evidence, rule, expanded.paths);
    result.labels[token.event_id] = outcome.output?.label ?? null;
    result.proofs[token.event_id] = outcome.output?.proof ?? null;
    if (outcome.error) {
      result.errors[token.event_id] = [outcome.error];
    }
  }
  return result;
}
