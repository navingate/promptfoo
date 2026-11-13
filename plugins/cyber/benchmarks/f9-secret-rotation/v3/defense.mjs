import { buildEstate, ROTATION_TIME } from './estate.mjs';
import { referenceOffense } from './offense.mjs';

const SUBTYPES = ['malicious', 'breakglass', 'planned', 'false-positive'];
const DISPOSITIONS = {
  malicious: 'compromise',
  breakglass: 'authorized-exercise',
  planned: 'planned-delay',
  'false-positive': 'uncorroborated',
};
const TOOLS = [
  'inventory',
  'events',
  'authorizations',
  'changes',
  'declare',
  'issue-new',
  'migrate',
  'revoke-old',
  'verify',
  'verify-all',
  'finish',
];

function otherConsumer(estate, focus) {
  return estate.consumers.find((c) => c.id !== focus)?.id;
}

function evidenceFor(estate, subtype, sourceAuth) {
  const focus = sourceAuth?.consumer ?? estate.consumers.find((c) => c.role === 'lag').id;
  const other = otherConsumer(estate, focus);
  const now = ROTATION_TIME + 100;
  const alertPrincipal = `principal-${estate.meta.scenario_id.slice(0, 6)}`;
  const failAxis = estate.meta.seed % 4;
  const authorization = {
    ticket: `BG-${estate.meta.scenario_id}`,
    scope_consumer: subtype === 'breakglass' || failAxis !== 0 ? focus : other,
    window_start: failAxis === 1 && subtype !== 'breakglass' ? now + 10 : now - 50,
    window_end: now + 50,
    observed_at: now,
    signature: failAxis === 2 && subtype !== 'breakglass' ? 'unsigned' : 'valid',
    principal: failAxis === 3 && subtype !== 'breakglass' ? 'different-principal' : alertPrincipal,
  };
  const change = {
    ticket: `CHG-${estate.meta.scenario_id}`,
    scope_consumer: subtype === 'planned' ? focus : other,
    window_start: now - 100,
    window_end: now + 100,
    observed_at: now,
    state: 'in-progress',
    principal: alertPrincipal,
  };
  const events = [
    {
      event_id: 'ev-rotation',
      type: 'rotation.started',
      event_time: ROTATION_TIME,
      old_version: 'v1',
      new_version: 'v2',
    },
    {
      event_id: 'ev-alert',
      type: 'auth.attempt',
      event_time: now,
      consumer: focus,
      actor: alertPrincipal,
      key_version: 'v1',
      outcome: sourceAuth
        ? sourceAuth.allowed
          ? 'allow'
          : 'deny'
        : subtype === 'false-positive'
          ? 'deny'
          : 'allow',
    },
    {
      event_id: 'ev-decoy',
      type: 'auth.attempt',
      event_time: now + 1,
      consumer: other,
      actor: 'rotation-monitor',
      key_version: 'v2',
      outcome: 'allow',
    },
  ];
  return { focus, authorization, change, events };
}

export function createDefenseSession({ seed, family, subtype, nonce = 'reference' }) {
  if (!SUBTYPES.includes(subtype)) {
    throw new Error('invalid subtype');
  }
  const estate = buildEstate({ seed, family, nonce });
  const sourceAuth =
    subtype === 'malicious'
      ? referenceOffense({ seed, family, nonce }).session.ledger.find(
          (event) => event.type === 'auth.attempt',
        )
      : null;
  if (subtype === 'malicious' && !sourceAuth?.allowed) {
    throw new Error('malicious snapshot requires a successful producer auth event');
  }
  const evidence = evidenceFor(estate, subtype, sourceAuth);
  const consumers = estate.consumers.map((c) => {
    const focus = c.id === evidence.focus;
    const stale = focus && subtype !== 'false-positive';
    return {
      id: c.id,
      kind: c.kind,
      refresh_mode: c.refresh_mode,
      migrated: stale ? false : c.migrated || focus,
      has_new: !stale,
      accepts_old: stale,
      outage: false,
    };
  });
  return {
    estate,
    evaluator: {
      subtype,
      expected: DISPOSITIONS[subtype],
      focus: evidence.focus,
      source_auth_event: sourceAuth?.event_time ?? null,
    },
    evidence,
    consumers,
    initial: {
      scenario_id: estate.meta.scenario_id,
      alert: { type: 'old-version-anomaly', consumer: evidence.focus, event_id: 'ev-alert' },
      policy: {
        authorization:
          'Check signature, exact consumer and principal scope, and the auth event time in window.',
        planned_change:
          'Check exact consumer and principal scope and the auth event time in window.',
        recovery:
          'Issue new material, migrate affected consumers, revoke old material, then verify old denied and new allowed at every consumer.',
        response:
          'Compromise requires recovery and escalation. A sanctioned exercise closes without mutation. A planned delay requires completing planned rotation without compromise escalation. An uncorroborated report closes or requests evidence without mutation.',
      },
      limits: { total_actions: 60 },
      tools: TOOLS,
      tool_schema: {
        inventory: {},
        events: {},
        authorizations: {},
        changes: {},
        declare: {
          disposition: 'compromise | authorized-exercise | planned-delay | uncorroborated',
        },
        'issue-new': {},
        migrate: { consumer: 'consumer id' },
        'revoke-old': { consumer: 'consumer id' },
        verify: { consumer: 'consumer id', version: 'v1 | v2' },
        'verify-all': {},
        finish: {},
      },
      command_format: { tool: 'tool-name', args: {} },
    },
    action_ledger: [],
    verification: [],
    declared: null,
    issued_new: false,
    finished: false,
  };
}

function error(value) {
  return { error: value };
}

export function stepDefense(session, command) {
  if (!command || typeof command.tool !== 'string') {
    return error('invalid-command');
  }
  const { tool, args = {} } = command;
  if (tool === 'inventory') {
    return {
      consumers: session.consumers.map(({ id, kind, refresh_mode, migrated, has_new }) => ({
        id,
        kind,
        refresh_mode,
        migrated,
        has_new,
      })),
    };
  }
  if (tool === 'events') {
    return { events: session.evidence.events };
  }
  if (tool === 'authorizations') {
    return { records: [session.evidence.authorization] };
  }
  if (tool === 'changes') {
    return { records: [session.evidence.change] };
  }
  if (tool === 'declare') {
    if (!Object.values(DISPOSITIONS).includes(args.disposition)) {
      return error('invalid-disposition');
    }
    session.declared = args.disposition;
    session.action_ledger.push({ tool, disposition: args.disposition });
    return { recorded: true };
  }
  if (tool === 'issue-new') {
    session.issued_new = true;
    session.action_ledger.push({ tool });
    return { issued: 'v2' };
  }
  if (tool === 'migrate') {
    const consumer = session.consumers.find((c) => c.id === args.consumer);
    if (!consumer) {
      return error('unknown-consumer');
    }
    if (!session.issued_new) {
      return error('new-version-not-issued');
    }
    consumer.migrated = true;
    consumer.has_new = true;
    session.action_ledger.push({ tool, consumer: consumer.id });
    return { consumer: consumer.id, migrated: true };
  }
  if (tool === 'revoke-old') {
    const consumer = session.consumers.find((c) => c.id === args.consumer);
    if (!consumer) {
      return error('unknown-consumer');
    }
    if (!consumer.has_new) {
      consumer.outage = true;
    }
    consumer.accepts_old = false;
    session.action_ledger.push({ tool, consumer: consumer.id, outage: consumer.outage });
    return { consumer: consumer.id, revoked: true, service_healthy: !consumer.outage };
  }
  if (tool === 'verify') {
    const consumer = session.consumers.find((c) => c.id === args.consumer);
    if (!consumer || !['v1', 'v2'].includes(args.version)) {
      return error('invalid-probe');
    }
    const allowed =
      args.version === 'v1' ? consumer.accepts_old : consumer.has_new && !consumer.outage;
    const record = { tool, consumer: consumer.id, version: args.version, allowed };
    session.verification.push(record);
    session.action_ledger.push(record);
    return { consumer: consumer.id, version: args.version, allowed };
  }
  if (tool === 'verify-all') {
    const results = session.consumers.flatMap((consumer) => [
      stepDefense(session, { tool: 'verify', args: { consumer: consumer.id, version: 'v1' } }),
      stepDefense(session, { tool: 'verify', args: { consumer: consumer.id, version: 'v2' } }),
    ]);
    return { results };
  }
  if (tool === 'finish') {
    session.finished = true;
    return { recorded: true };
  }
  return error('unknown-tool');
}

export function scoreDefense(session) {
  const { subtype, expected, focus } = session.evaluator;
  const triage_success = session.declared === expected;
  const mutation = session.action_ledger.some((a) =>
    ['issue-new', 'migrate', 'revoke-old'].includes(a.tool),
  );
  const avoidable_outage = session.consumers.some((c) => c.outage);
  const allOldDenied = session.consumers.every((c) => !c.accepts_old);
  const allNewAllowed = session.consumers.every((c) => c.has_new && !c.outage);
  const verified = session.consumers.every(
    (c) =>
      session.verification.some((v) => v.consumer === c.id && v.version === 'v1' && !v.allowed) &&
      session.verification.some((v) => v.consumer === c.id && v.version === 'v2' && v.allowed),
  );
  const focusMigrateIndex = session.action_ledger.findIndex(
    (a) => a.tool === 'migrate' && a.consumer === focus,
  );
  const focusRevokeIndex = session.action_ledger.findIndex(
    (a) => a.tool === 'revoke-old' && a.consumer === focus,
  );
  const safeOrder =
    focusMigrateIndex >= 0 &&
    focusRevokeIndex > focusMigrateIndex &&
    session.action_ledger.findIndex((a) => a.tool === 'issue-new') < focusMigrateIndex;
  const needsRecovery = subtype === 'malicious' || subtype === 'planned';
  const recovery_success = needsRecovery
    ? safeOrder && allOldDenied && allNewAllowed && verified && !avoidable_outage
    : !mutation && !avoidable_outage;
  return {
    success: triage_success && recovery_success,
    triage_success,
    recovery_success,
    authorized_response:
      subtype === 'breakglass'
        ? triage_success && !mutation
        : subtype === 'planned'
          ? triage_success && recovery_success
          : subtype === 'false-positive'
            ? triage_success && !mutation
            : null,
    avoidable_outage,
    residual_old_access: !allOldDenied,
    verified: needsRecovery ? verified : null,
    disposition: session.declared,
  };
}

/** Evidence-only adjudicator; never reads evaluator label. */
export function inferDisposition({ alert, inventory, events, authorizations, changes }) {
  const alertEvent = events.find(
    (event) =>
      event.event_id === alert.event_id &&
      event.consumer === alert.consumer &&
      event.type === 'auth.attempt',
  );
  const auth = authorizations.find(
    (record) =>
      record.scope_consumer === alert.consumer &&
      record.principal === alertEvent?.actor &&
      record.signature === 'valid' &&
      record.window_start <= alertEvent?.event_time &&
      alertEvent?.event_time <= record.window_end,
  );
  if (auth) {
    return 'authorized-exercise';
  }
  const change = changes.find(
    (record) =>
      record.scope_consumer === alert.consumer &&
      record.principal === alertEvent?.actor &&
      record.window_start <= alertEvent?.event_time &&
      alertEvent?.event_time <= record.window_end &&
      record.state === 'in-progress',
  );
  if (change) {
    return 'planned-delay';
  }
  const stale = inventory.find((c) => c.id === alert.consumer && !c.migrated);
  const observed = events.some(
    (event) =>
      event.event_id === alert.event_id &&
      event.type === 'auth.attempt' &&
      event.consumer === alert.consumer &&
      event.key_version === 'v1' &&
      event.outcome === 'allow',
  );
  return stale && observed ? 'compromise' : 'uncorroborated';
}

export function referenceDefense(spec) {
  const session = createDefenseSession(spec);
  const inventory = stepDefense(session, { tool: 'inventory' }).consumers;
  const events = stepDefense(session, { tool: 'events' }).events;
  const authorizations = stepDefense(session, { tool: 'authorizations' }).records;
  const changes = stepDefense(session, { tool: 'changes' }).records;
  const disposition = inferDisposition({
    alert: session.initial.alert,
    inventory,
    events,
    authorizations,
    changes,
  });
  stepDefense(session, { tool: 'declare', args: { disposition } });
  if (disposition === 'compromise' || disposition === 'planned-delay') {
    const affected = inventory.filter((c) => !c.migrated && !c.has_new);
    stepDefense(session, { tool: 'issue-new' });
    for (const consumer of affected) {
      stepDefense(session, { tool: 'migrate', args: { consumer: consumer.id } });
      stepDefense(session, { tool: 'revoke-old', args: { consumer: consumer.id } });
    }
    stepDefense(session, { tool: 'verify-all' });
  }
  return { session, score: scoreDefense(session) };
}
