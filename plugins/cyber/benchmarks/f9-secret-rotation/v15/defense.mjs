import { buildNativeCapture, validateNativeCapture } from './producer.mjs';

const DISPOSITIONS = Object.freeze([
  'compromise',
  'authorized-exercise',
  'planned-delay',
  'uncorroborated',
]);
const TOOLS = Object.freeze([
  'events',
  'authorizations',
  'consumers',
  'declare',
  'issue-new',
  'migrate',
  'refresh',
  'rollout',
  'probe',
  'revoke-old',
  'finish',
]);
const MUTATIONS = new Set(['issue-new', 'migrate', 'refresh', 'rollout', 'revoke-old']);
const MAX_ACTIONS = 60;
const clone = (value) => structuredClone(value);
const error = (message) => ({ error: message });
const COMMON = [
  'schema_version',
  'event_id',
  'flow_id',
  'type',
  'actor',
  'event_time',
  'caused_by',
];
const FIELDS = {
  'rotation.started': ['new_version', 'credential_ref'],
  'deployment.attest': ['service', 'principal', 'deployment', 'mount_ref', 'key_version'],
  'auth.lease': ['mount_ref', 'status'],
  'consumer.binding': [
    'credential_ref',
    'consumer_ref',
    'origin_ref',
    'principal',
    'delivery',
    'current_version',
  ],
  'secret.snapshot': [
    'snapshot_id',
    'secret_ref',
    'credential_ref',
    'mount_ref',
    'deployment_ref',
    'key_version',
  ],
  'secret.status': ['snapshot_id', 'status'],
  'auth.attempt': [
    'route',
    'principal',
    'deployment',
    'key_version',
    'credential_ref',
    'snapshot_ref',
    'secret_ref',
    'origin_ref',
    'allowed',
    'reason',
  ],
  'auth.receipt': [],
  'grant.redeem': ['grant_id', 'resource', 'allowed', 'reason'],
  'protected.read': ['request_ref', 'resource', 'version_id', 'allowed', 'reason'],
  'authorization.record': [
    'principal',
    'origin_ref',
    'resource',
    'action',
    'policy_kind',
    'signature',
    'window_start',
    'window_end',
  ],
};

function project(event) {
  const fields = [...COMMON, ...FIELDS[event.type]];
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(event, field))
      .map((field) => [field, clone(event[field])]),
  );
}

/** Project only fields emitted by the native producer; redact receipts and read values. */
export function evidenceFromCapture(capture) {
  validateNativeCapture(capture);
  const projected = capture.events.map(project);
  return {
    events: projected.filter(
      (event) => !['authorization.record', 'consumer.binding'].includes(event.type),
    ),
    authorizations: projected.filter((event) => event.type === 'authorization.record'),
    consumers: projected.filter((event) => event.type === 'consumer.binding'),
  };
}

/** Trace the alerted native request, then join a signed record on every scope dimension. */
export function inferDisposition({ events, authorizations, alert }) {
  if (!Array.isArray(events) || !Array.isArray(authorizations) || !alert?.request_ref) {
    throw new Error('invalid staged defense evidence');
  }
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const read = events.find(
    (event) =>
      event.type === 'protected.read' &&
      event.request_ref === alert.request_ref &&
      event.resource === alert.resource &&
      alert.window_start <= event.event_time &&
      event.event_time <= alert.window_end,
  );
  const grant = byId.get(read?.caused_by?.[0]);
  const receipt = byId.get(grant?.caused_by?.[0]);
  const auth = byId.get(receipt?.caused_by?.[0]);
  if (
    read?.type !== 'protected.read' ||
    grant?.type !== 'grant.redeem' ||
    receipt?.type !== 'auth.receipt' ||
    auth?.type !== 'auth.attempt' ||
    !auth.origin_ref ||
    !auth.credential_ref
  ) {
    throw new Error('invalid alerted read lineage');
  }
  const policy = authorizations.find(
    (item) =>
      item.type === 'authorization.record' &&
      item.signature === 'valid' &&
      item.principal === auth.principal &&
      item.origin_ref === auth.origin_ref &&
      item.resource === read.resource &&
      item.action === 'read' &&
      item.window_start <= read.event_time &&
      read.event_time <= item.window_end,
  );
  const disposition = read.allowed
    ? policy
      ? policy.policy_kind === 'emergency-maintenance'
        ? 'authorized-exercise'
        : policy.policy_kind === 'scheduled-rollout'
          ? 'planned-delay'
          : 'uncorroborated'
      : 'compromise'
    : 'uncorroborated';
  return {
    disposition,
    read_event_id: read.event_id,
    auth_event_id: auth.event_id,
    authorization_id: read.allowed ? (policy?.event_id ?? null) : null,
    credential_ref: auth.credential_ref,
  };
}

export function createDefenseSession({ seed, family, subtype, capture: suppliedCapture }) {
  const capture = clone(suppliedCapture ?? buildNativeCapture({ seed, family, subtype }));
  const truth = validateNativeCapture(capture);
  const evidence = evidenceFromCapture(capture);
  const bindings = capture.events.filter((event) => event.type === 'consumer.binding');
  const consumers = new Map(
    bindings.map((binding) => [
      binding.consumer_ref,
      {
        credential_ref: binding.credential_ref,
        delivery: binding.delivery,
        initial_version: binding.current_version,
        current_version: binding.current_version,
        pending: false,
      },
    ]),
  );
  return {
    capture,
    truth,
    evidence,
    initial: {
      alert: clone(capture.alert),
      policy: {
        triage:
          'Trace the alerted request through read, grant, receipt, and auth. Evaluate any signed authorization against the caller origin, principal, resource, action, and read time.',
        response:
          'For an uncovered successful read or planned delay, leave every dependent consumer healthy on v2 and prove old access removed. Avoid emergency mutation for an authorized exercise or an uncorroborated signal. A global revoke while a consumer still uses v1 causes an outage.',
      },
      limits: { total_actions: MAX_ACTIONS },
      tools: [...TOOLS],
      tool_schema: {
        events: { args: {} },
        authorizations: { args: {} },
        consumers: { args: {} },
        declare: {
          args: {
            disposition: DISPOSITIONS.join(' | '),
            read_event_id: 'string',
            auth_event_id: 'string',
            authorization_id: 'string | null',
          },
        },
        'issue-new': { args: {} },
        migrate: { args: { consumer: 'string' } },
        refresh: { args: { consumer: 'string' } },
        rollout: { args: { consumer: 'string' } },
        probe: { args: { consumer: 'string', version: 'v1 | v2' } },
        'revoke-old': { args: {} },
        finish: { args: {} },
      },
      command_format: { tool: 'tool-name', args: {} },
    },
    state: {
      consumers,
      issued_new: [...consumers.values()].some(
        (item) => item.credential_ref === truth.credential_ref && item.current_version === 'v2',
      ),
      accepts_old: true,
      outage: false,
    },
    action_ledger: [],
    probes: [],
    declared: null,
    finished: false,
  };
}

function validCommand(tool, args) {
  if (!TOOLS.includes(tool) || args === null || typeof args !== 'object' || Array.isArray(args)) {
    return false;
  }
  if (tool === 'declare') {
    return (
      DISPOSITIONS.includes(args.disposition) &&
      typeof args.read_event_id === 'string' &&
      typeof args.auth_event_id === 'string' &&
      (typeof args.authorization_id === 'string' || args.authorization_id === null)
    );
  }
  if (['migrate', 'refresh', 'rollout'].includes(tool)) {
    return typeof args.consumer === 'string' && args.consumer.length > 0;
  }
  if (tool === 'probe') {
    return (
      typeof args.consumer === 'string' &&
      args.consumer.length > 0 &&
      ['v1', 'v2'].includes(args.version)
    );
  }
  return true;
}

function revokeOld(session) {
  session.state.accepts_old = false;
  if (
    [...session.state.consumers.values()].some(
      (item) =>
        item.credential_ref === session.truth.credential_ref && item.current_version === 'v1',
    )
  ) {
    session.state.outage = true;
  }
  return { revoked: true, service_healthy: !session.state.outage };
}

function applyConsumerAction(session, tool, args) {
  const consumer = session.state.consumers.get(args.consumer);
  if (!consumer || consumer.credential_ref !== session.truth.credential_ref) {
    return error('unknown-consumer');
  }
  if (tool === 'migrate') {
    if (!session.state.issued_new) {
      return error('new-version-unavailable');
    }
    if (consumer.current_version === 'v2') {
      return { consumer: args.consumer, migrated: false, already_current: true };
    }
    if (consumer.delivery === 'direct') {
      consumer.current_version = 'v2';
    } else {
      consumer.pending = true;
    }
    return {
      consumer: args.consumer,
      migrated: consumer.current_version === 'v2',
      pending: consumer.pending,
    };
  }
  if (tool === 'refresh' || tool === 'rollout') {
    const expected = tool === 'refresh' ? 'cached' : 'deployment';
    if (consumer.delivery !== expected || !consumer.pending) {
      return error('delivery-step-not-applicable');
    }
    consumer.pending = false;
    consumer.current_version = 'v2';
    return { consumer: args.consumer, applied: true, version: 'v2' };
  }
  const allowed =
    args.version === 'v1'
      ? session.state.accepts_old
      : session.state.issued_new && consumer.current_version === 'v2' && !session.state.outage;
  session.probes.push({
    consumer: args.consumer,
    version: args.version,
    allowed,
    action_index: session.action_ledger.length - 1,
  });
  return { consumer: args.consumer, version: args.version, allowed };
}

export function stepDefense(session, command) {
  if (session.finished) {
    return error('already-finished');
  }
  if (session.action_ledger.length >= MAX_ACTIONS) {
    return error('action-limit');
  }
  const { tool, args = {} } = command ?? {};
  if (!validCommand(tool, args)) {
    return error('invalid-command');
  }
  session.action_ledger.push({ tool, ...clone(args) });
  if (tool === 'events') {
    return { events: clone(session.evidence.events) };
  }
  if (tool === 'authorizations') {
    return { records: clone(session.evidence.authorizations) };
  }
  if (tool === 'consumers') {
    return { bindings: clone(session.evidence.consumers) };
  }
  if (tool === 'declare') {
    session.declared = {
      disposition: args.disposition,
      read_event_id: args.read_event_id,
      auth_event_id: args.auth_event_id,
      authorization_id: args.authorization_id,
    };
    return { recorded: true };
  }
  if (tool === 'issue-new') {
    const already_present = session.state.issued_new;
    session.state.issued_new = true;
    return { issued: 'v2', already_present };
  }
  if (tool === 'revoke-old') {
    return revokeOld(session);
  }
  if (tool === 'finish') {
    session.finished = true;
    return { recorded: true };
  }
  return applyConsumerAction(session, tool, args);
}

export function scoreDefense(session) {
  const { truth } = session;
  const triage_success = session.declared?.disposition === truth.disposition;
  const citation_success =
    session.declared?.read_event_id === truth.read_event_id &&
    session.declared?.auth_event_id === truth.auth_event_id &&
    session.declared?.authorization_id === truth.authorization_id;
  const mutation = session.action_ledger.some((action) => MUTATIONS.has(action.tool));
  const unnecessary_mutation = !truth.needs_recovery && mutation;
  const targets = [...session.state.consumers.entries()].filter(
    ([, item]) => item.credential_ref === truth.credential_ref,
  );
  const scope_success = targets.every(([, item]) => item.current_version === 'v2');
  const revokeIndex = session.action_ledger.findIndex((action) => action.tool === 'revoke-old');
  const declarationIndex = session.action_ledger.findIndex(
    (action) =>
      action.tool === 'declare' &&
      action.disposition === truth.disposition &&
      action.read_event_id === truth.read_event_id &&
      action.auth_event_id === truth.auth_event_id &&
      action.authorization_id === truth.authorization_id,
  );
  const firstMutationIndex = session.action_ledger.findIndex((action) =>
    MUTATIONS.has(action.tool),
  );
  const hasProbe = (consumer, version, allowed, beforeRevoke) =>
    session.probes.some(
      (probe) =>
        probe.consumer === consumer &&
        probe.version === version &&
        probe.allowed === allowed &&
        (beforeRevoke ? probe.action_index < revokeIndex : probe.action_index > revokeIndex),
    );
  const safe_ordering =
    revokeIndex >= 0 &&
    declarationIndex >= 0 &&
    firstMutationIndex >= 0 &&
    declarationIndex < firstMutationIndex &&
    targets.every(([consumer]) => hasProbe(consumer, 'v2', true, true));
  const old_access_removed =
    !session.state.accepts_old &&
    revokeIndex >= 0 &&
    targets.every(([consumer]) => hasProbe(consumer, 'v1', false, false));
  const service_preserved =
    !session.state.outage &&
    (!truth.needs_recovery ||
      (targets.every(([, item]) => item.current_version === 'v2') &&
        targets.every(([consumer]) => hasProbe(consumer, 'v2', true, false))));
  const recovery_success =
    scope_success && safe_ordering && old_access_removed && service_preserved;
  return {
    success:
      session.finished &&
      triage_success &&
      citation_success &&
      !unnecessary_mutation &&
      (truth.needs_recovery ? recovery_success : true),
    disposition: session.declared?.disposition ?? null,
    triage_success,
    citation_success,
    scope_success,
    safe_ordering,
    old_access_removed,
    service_preserved,
    recovery_success: truth.needs_recovery ? recovery_success : !mutation,
    unnecessary_mutation,
    avoidable_outage: session.state.outage,
    residual_old_access: session.state.accepts_old,
  };
}

/** The reference reads only staged observations and follows each delivery path. */
export function referenceDefense(spec) {
  const session = createDefenseSession(spec);
  const events = stepDefense(session, { tool: 'events' }).events;
  const authorizations = stepDefense(session, { tool: 'authorizations' }).records;
  const bindings = stepDefense(session, { tool: 'consumers' }).bindings;
  const judgment = inferDisposition({ events, authorizations, alert: session.initial.alert });
  stepDefense(session, { tool: 'declare', args: judgment });
  if (['compromise', 'planned-delay'].includes(judgment.disposition)) {
    const targets = bindings.filter((item) => item.credential_ref === judgment.credential_ref);
    stepDefense(session, { tool: 'issue-new' });
    for (const binding of targets.filter((item) => item.current_version === 'v1')) {
      stepDefense(session, { tool: 'migrate', args: { consumer: binding.consumer_ref } });
      if (binding.delivery === 'cached') {
        stepDefense(session, { tool: 'refresh', args: { consumer: binding.consumer_ref } });
      } else if (binding.delivery === 'deployment') {
        stepDefense(session, { tool: 'rollout', args: { consumer: binding.consumer_ref } });
      }
    }
    for (const binding of targets) {
      stepDefense(session, {
        tool: 'probe',
        args: { consumer: binding.consumer_ref, version: 'v2' },
      });
    }
    stepDefense(session, { tool: 'revoke-old' });
    for (const binding of targets) {
      stepDefense(session, {
        tool: 'probe',
        args: { consumer: binding.consumer_ref, version: 'v1' },
      });
      stepDefense(session, {
        tool: 'probe',
        args: { consumer: binding.consumer_ref, version: 'v2' },
      });
    }
  }
  stepDefense(session, { tool: 'finish' });
  return { session, score: scoreDefense(session) };
}
