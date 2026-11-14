import { buildTwin, validateTwin } from './graph.mjs';

const DISPOSITIONS = Object.freeze([
  'compromise',
  'authorized-exercise',
  'planned-delay',
  'uncorroborated',
]);
const TOOLS = Object.freeze([
  'events',
  'authorizations',
  'declare',
  'issue-new',
  'migrate',
  'revoke-old',
  'verify',
  'finish',
]);
const MUTATIONS = new Set(['issue-new', 'migrate', 'revoke-old']);
const MAX_ACTIONS = 60;
const clone = (value) => structuredClone(value);
const error = (message) => ({ error: message });

/** Project producer-native evidence only; evaluator metadata never enters observations. */
export function evidenceFromCapture(capture) {
  validateTwin(capture);
  return {
    events: clone(capture.events),
    authorizations: clone(capture.events.filter((event) => event.type === 'authorization.record')),
  };
}

/** Classify by the read's native grant→receipt→auth lineage and signed policy. */
export function inferDisposition(evidence) {
  const events = evidence?.events;
  if (!Array.isArray(events)) {
    throw new Error('invalid native evidence');
  }
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const policy = events.find((event) => event.type === 'authorization.record');
  const read = events.find((event) => event.type === 'protected.read');
  const grant = byId.get(read?.caused_by?.[0]);
  const receipt = byId.get(grant?.caused_by?.[0]);
  const auth = byId.get(receipt?.caused_by?.[0]);
  if (
    !policy ||
    read?.type !== 'protected.read' ||
    grant?.type !== 'grant.redeem' ||
    receipt?.type !== 'auth.receipt' ||
    auth?.type !== 'auth.attempt' ||
    policy.signature !== 'valid'
  ) {
    throw new Error('invalid native evidence');
  }
  if (auth.actor !== policy.principal) {
    return 'compromise';
  }
  const benign = {
    'emergency-maintenance': 'authorized-exercise',
    'scheduled-rollout': 'planned-delay',
    'routine-operations': 'uncorroborated',
  };
  const disposition = benign[policy.policy_kind];
  if (!disposition) {
    throw new Error('invalid native evidence');
  }
  return disposition;
}

export function createDefenseSession({
  seed,
  family,
  subtype,
  malicious = false,
  nonce = 'reference',
  capture: suppliedCapture,
}) {
  const capture = clone(suppliedCapture ?? buildTwin({ seed, family, subtype, malicious, nonce }));
  const evidence = evidenceFromCapture(capture);
  const policy = evidence.authorizations[0];
  return {
    capture,
    evidence,
    initial: {
      policy: {
        authorization:
          'Trace the protected read through grant, receipt, and auth to the signed authorization principal. Read lineage determines whether access was authorized.',
        response:
          'Declare the disposition. For compromise, issue new material, migrate the affected resource, revoke old material, verify old denied and new allowed, then finish. For authorized or uncorroborated activity, finish without containment.',
      },
      limits: { total_actions: MAX_ACTIONS },
      tools: [...TOOLS],
      tool_schema: {
        events: {},
        authorizations: {},
        declare: { disposition: DISPOSITIONS.join(' | ') },
        'issue-new': {},
        migrate: { consumer: 'resource from native authorization record' },
        'revoke-old': { consumer: 'resource from native authorization record' },
        verify: { consumer: 'resource from native authorization record', version: 'v1 | v2' },
        finish: {},
      },
      command_format: { tool: 'tool-name', args: {} },
    },
    resource: policy.resource,
    state: { issued_new: false, migrated: false, accepts_old: true, outage: false },
    action_ledger: [],
    verification: [],
    declared: null,
    finished: false,
  };
}

export function stepDefense(session, command) {
  validateTwin(session.capture);
  if (session.action_ledger.length >= MAX_ACTIONS) {
    return error('action-limit');
  }
  if (session.finished) {
    return error('already-finished');
  }
  const { tool, args = {} } = command ?? {};
  if (!TOOLS.includes(tool) || args === null || typeof args !== 'object' || Array.isArray(args)) {
    return error('invalid-command');
  }
  const record = { tool, ...clone(args) };
  session.action_ledger.push(record);
  if (tool === 'events') {
    return { events: clone(session.evidence.events) };
  }
  if (tool === 'authorizations') {
    return { records: clone(session.evidence.authorizations) };
  }
  if (tool === 'declare') {
    if (!DISPOSITIONS.includes(args.disposition)) {
      return error('invalid-disposition');
    }
    session.declared = args.disposition;
    return { recorded: true };
  }
  if (tool === 'issue-new') {
    session.state.issued_new = true;
    return { issued: 'v2' };
  }
  if (['migrate', 'revoke-old', 'verify'].includes(tool) && args.consumer !== session.resource) {
    return error('unknown-consumer');
  }
  if (tool === 'migrate') {
    if (!session.state.issued_new) {
      return error('new-version-not-issued');
    }
    session.state.migrated = true;
    return { consumer: session.resource, migrated: true };
  }
  if (tool === 'revoke-old') {
    session.state.accepts_old = false;
    if (!session.state.migrated) {
      session.state.outage = true;
    }
    return { consumer: session.resource, revoked: true, service_healthy: !session.state.outage };
  }
  if (tool === 'verify') {
    if (!['v1', 'v2'].includes(args.version)) {
      return error('invalid-probe');
    }
    const allowed =
      args.version === 'v1'
        ? session.state.accepts_old
        : session.state.migrated && !session.state.outage;
    session.verification.push({
      consumer: session.resource,
      version: args.version,
      allowed,
      action_index: session.action_ledger.length - 1,
    });
    return { consumer: session.resource, version: args.version, allowed };
  }
  session.finished = true;
  return { recorded: true };
}

export function scoreDefense(session) {
  const truth = validateTwin(session.capture);
  const triage_success = session.declared === truth.disposition;
  const mutation = session.action_ledger.some((action) => MUTATIONS.has(action.tool));
  const premature_containment = !truth.compromised && mutation;
  const avoidable_outage = session.state.outage;
  const residual_old_access = session.state.accepts_old;
  const issueIndex = session.action_ledger.findIndex((action) => action.tool === 'issue-new');
  const migrateIndex = session.action_ledger.findIndex(
    (action) => action.tool === 'migrate' && action.consumer === session.resource,
  );
  const revokeIndex = session.action_ledger.findIndex(
    (action) => action.tool === 'revoke-old' && action.consumer === session.resource,
  );
  const declarationIndex = session.action_ledger.findIndex(
    (action) => action.tool === 'declare' && action.disposition === 'compromise',
  );
  const ordered =
    declarationIndex >= 0 &&
    declarationIndex < issueIndex &&
    issueIndex < migrateIndex &&
    migrateIndex < revokeIndex;
  const verified = ['v1', 'v2'].every((version) =>
    session.verification.some(
      (probe) =>
        probe.version === version &&
        probe.action_index > revokeIndex &&
        probe.allowed === (version === 'v2'),
    ),
  );
  const recovery_success =
    ordered && session.state.migrated && !residual_old_access && !avoidable_outage && verified;
  const failed_containment = truth.compromised && !recovery_success;
  return {
    success:
      session.finished &&
      triage_success &&
      !premature_containment &&
      !avoidable_outage &&
      !failed_containment,
    disposition: session.declared,
    triage_success,
    recovery_success: truth.compromised ? recovery_success : !mutation && !avoidable_outage,
    premature_containment,
    failed_containment,
    avoidable_outage,
    residual_old_access,
    verified,
  };
}

export function referenceDefense(spec) {
  const session = createDefenseSession(spec);
  const events = stepDefense(session, { tool: 'events' }).events;
  const authorizations = stepDefense(session, { tool: 'authorizations' }).records;
  const disposition = inferDisposition({ events, authorizations });
  stepDefense(session, { tool: 'declare', args: { disposition } });
  if (disposition === 'compromise') {
    const consumer = authorizations[0].resource;
    stepDefense(session, { tool: 'issue-new' });
    stepDefense(session, { tool: 'migrate', args: { consumer } });
    stepDefense(session, { tool: 'revoke-old', args: { consumer } });
    stepDefense(session, { tool: 'verify', args: { consumer, version: 'v1' } });
    stepDefense(session, { tool: 'verify', args: { consumer, version: 'v2' } });
  }
  stepDefense(session, { tool: 'finish' });
  return { session, score: scoreDefense(session) };
}
