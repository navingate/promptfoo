import crypto from 'node:crypto';

import { buildEstate, GRANT_TIME, PROTECTED_RESOURCE, ROTATION_TIME } from './estate.mjs';
import { createOffenseSession, inferGrant, referenceOffense, stepOffense } from './offense.mjs';

export const CAPTURE_SCHEMA = 'f9-native-v7';
export const PAIR_CONTRACT = 'f9-paired-v7';
export const SUBTYPES = Object.freeze(['malicious', 'breakglass', 'planned', 'false-positive']);

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function nativeProbe(spec, { actor, keyVersion, authTime, flowTag, route }) {
  const session = createOffenseSession({ ...spec, actor, keyVersion, authTime, flowTag });
  const secret = keyVersion === 'v2' ? session.estate.newSecret : session.estate.secret;
  const result = stepOffense(session, { tool: 'authenticate', args: { route, secret } });
  return { event: session.ledger.find((event) => event.type === 'auth.attempt'), result };
}

function nativeV2Chain(spec, principal) {
  const session = createOffenseSession({
    ...spec,
    variant: 'atomic',
    actor: principal,
    keyVersion: 'v2',
    flowTag: 'main-v2',
  });
  const lag = session.estate.consumers.find((consumer) => consumer.role === 'lag');
  const auth = stepOffense(session, {
    tool: 'authenticate',
    args: {
      route: lag.route,
      secret: session.estate.newSecret,
    },
  });
  if (!auth.allowed) {
    throw new Error('native v2 auth did not complete');
  }
  const catalogue = stepOffense(session, { tool: 'grants', args: { receipt: auth.receipt } });
  const events = stepOffense(session, {
    tool: 'grant-events',
    args: { receipt: auth.receipt },
  }).events;
  const grant = inferGrant({ grants: catalogue.grants, events, context: catalogue.context });
  const redemption = stepOffense(session, {
    tool: 'redeem-grant',
    args: {
      receipt: auth.receipt,
      grant,
    },
  });
  if (!redemption.allowed) {
    throw new Error('native v2 grant did not complete');
  }
  stepOffense(session, { tool: 'protected-read', args: { token: redemption.read_token } });
  return session;
}

function redactedNativeEvent(event, arrivalOrder) {
  const { value, read_token, ...visible } = event;
  return {
    ...visible,
    arrival_order: arrivalOrder,
    ...(event.type === 'protected.read' ? { value_digest: digest(value) } : {}),
  };
}

function producerRecord(estate, type, suffix, fields) {
  return {
    schema_version: CAPTURE_SCHEMA,
    event_id: `${estate.meta.scenario_id}:${suffix}`,
    flow_id: `estate-${estate.meta.scenario_id}`,
    type,
    caused_by: [],
    ...fields,
  };
}

/** The producer executes the same native auth, grant, and read operations in every subtype. */
export function buildProducerCapture({ seed, family, subtype, nonce = 'reference' }) {
  if (!SUBTYPES.includes(subtype)) {
    throw new Error('invalid capture subtype');
  }
  const spec = {
    seed,
    family,
    nonce,
    variant: subtype === 'false-positive' ? 'atomic' : 'malicious',
  };
  const estate = buildEstate(spec);
  const focus = estate.consumers.find((consumer) => consumer.role === 'lag');
  const other = estate.consumers.find((consumer) => consumer.id !== focus.id);
  const principal = `principal-${estate.meta.scenario_id.slice(0, 6)}`;

  const main =
    subtype === 'false-positive'
      ? nativeV2Chain(spec, principal)
      : referenceOffense({ ...spec, actor: principal, flowTag: 'main-v1' }).session;
  const mainAuth = main.ledger.find((event) => event.type === 'auth.attempt');
  const mainGrant = main.ledger.find((event) => event.type === 'grant.redeem');
  const mainRead = main.ledger.find((event) => event.type === 'protected.read');
  if (!mainAuth?.allowed || !mainGrant?.allowed || !mainRead) {
    throw new Error('producer privileged chain incomplete');
  }

  const alert =
    subtype === 'false-positive'
      ? nativeProbe(spec, {
          actor: principal,
          keyVersion: 'v1',
          authTime: ROTATION_TIME - 20,
          flowTag: 'historical-v1',
          route: focus.route,
        }).event
      : mainAuth;
  const oldCheck = nativeProbe(spec, {
    actor: 'rotation-monitor',
    keyVersion: 'v1',
    authTime: ROTATION_TIME + 105,
    flowTag: 'old-check',
    route: subtype === 'false-positive' ? focus.route : other.route,
  }).event;
  const newCheck =
    subtype === 'false-positive'
      ? mainAuth
      : nativeProbe(spec, {
          actor: 'rotation-monitor',
          keyVersion: 'v2',
          authTime: ROTATION_TIME + 101,
          flowTag: 'new-check',
          route: other.route,
        }).event;
  if (!alert.allowed || oldCheck.allowed || !newCheck.allowed) {
    throw new Error('producer auth counterfactual incomplete');
  }

  const failAxis = seed % 4;
  const authorization = producerRecord(estate, 'authorization.record', 'authorization', {
    actor: 'approval-service',
    event_time: ROTATION_TIME + 40,
    arrival_order: 11,
    ticket: `BG-${estate.meta.scenario_id}`,
    scope_consumer: subtype === 'breakglass' || failAxis !== 0 ? focus.id : other.id,
    window_start:
      failAxis === 1 && subtype !== 'breakglass' ? ROTATION_TIME + 110 : ROTATION_TIME + 50,
    window_end: ROTATION_TIME + 150,
    observed_at: ROTATION_TIME + 100,
    signature: failAxis === 2 && subtype !== 'breakglass' ? 'unsigned' : 'valid',
    principal: failAxis === 3 && subtype !== 'breakglass' ? 'different-principal' : principal,
  });
  const change = producerRecord(estate, 'change.record', 'change', {
    actor: 'change-service',
    event_time: ROTATION_TIME + 30,
    arrival_order: 12,
    ticket: `CHG-${estate.meta.scenario_id}`,
    scope_consumer: subtype === 'planned' ? focus.id : other.id,
    window_start: ROTATION_TIME,
    window_end: ROTATION_TIME + 200,
    observed_at: ROTATION_TIME + 100,
    state: 'in-progress',
    principal,
  });
  const history = estate.grantEvents
    .filter((event) => event.grant_id === mainGrant.grant_id)
    .sort((a, b) => a.event_time - b.event_time);
  const statusEvents = history.map((event, index) =>
    producerRecord(estate, 'grant.status', `status-${mainGrant.grant_id}-${index}`, {
      flow_id: `grant-${estate.meta.scenario_id}-${mainGrant.grant_id}`,
      actor: 'grant-service',
      event_time: event.event_time,
      arrival_order: 7 + index,
      caused_by:
        index === 0 ? [] : [`${estate.meta.scenario_id}:status-${mainGrant.grant_id}-${index - 1}`],
      consumer: focus.id,
      grant_id: mainGrant.grant_id,
      status: event.status,
      scheduled: event.event_time > GRANT_TIME,
    }),
  );
  const inventory = estate.consumers.map((consumer, index) =>
    producerRecord(estate, 'consumer.inventory', `inventory-${consumer.id}`, {
      actor: 'inventory-service',
      event_time: ROTATION_TIME + 60,
      arrival_order: 13 + index,
      caused_by: [main.rotationEventId],
      consumer: consumer.id,
      kind: consumer.kind,
      refresh_mode: consumer.refresh_mode,
      migrated: consumer.migrated,
      has_new: consumer.has_new,
      accepts_old: consumer.accepts_old,
      outage: false,
    }),
  );

  const events = [
    redactedNativeEvent(main.ledger[0], 1),
    redactedNativeEvent(newCheck, 2),
    redactedNativeEvent(oldCheck, 3),
    redactedNativeEvent(alert, 4),
    redactedNativeEvent(mainGrant, 5),
    redactedNativeEvent(mainRead, 6),
    ...statusEvents,
    authorization,
    change,
    ...inventory,
  ];
  const capture = {
    schema_version: CAPTURE_SCHEMA,
    pair_contract_version: PAIR_CONTRACT,
    producer_id: 'f9-v7-native-service',
    capture_origin: 'deterministic-reference',
    capture_id: digest(`${estate.meta.scenario_id}|${subtype}|capture`).slice(0, 24),
    scenario_id: estate.meta.scenario_id,
    alert_event_id: alert.event_id,
    redaction: 'protected-value-and-read-token-removed',
    events,
  };
  validateProducerCapture(capture);
  return capture;
}

export function validateProducerCapture(capture) {
  if (
    capture?.schema_version !== CAPTURE_SCHEMA ||
    capture?.capture_origin !== 'deterministic-reference' ||
    capture?.redaction !== 'protected-value-and-read-token-removed' ||
    capture?.pair_contract_version !== PAIR_CONTRACT ||
    !Array.isArray(capture.events)
  ) {
    throw new Error('invalid capture version or shape');
  }
  const ids = new Map();
  for (const event of capture.events) {
    if (
      event?.schema_version !== CAPTURE_SCHEMA ||
      !event.event_id ||
      !event.flow_id ||
      !event.actor ||
      !Number.isFinite(event.event_time) ||
      !Number.isSafeInteger(event.arrival_order) ||
      !Array.isArray(event.caused_by)
    ) {
      throw new Error('invalid native event');
    }
    if (ids.has(event.event_id)) {
      throw new Error('duplicate native event id');
    }
    if ('value' in event || 'read_token' in event || 'secret' in event) {
      throw new Error('unredacted native capture');
    }
    ids.set(event.event_id, event);
  }
  for (const event of capture.events) {
    for (const causeId of event.caused_by) {
      if (typeof causeId !== 'string') {
        throw new Error('invalid causal reference');
      }
      const cause = ids.get(causeId);
      if (
        !cause ||
        cause.event_time > event.event_time ||
        cause.arrival_order >= event.arrival_order ||
        (cause.flow_id !== event.flow_id && cause.type !== 'rotation.started')
      ) {
        throw new Error('missing or incompatible causal event');
      }
    }
  }
  const ofType = (type) => capture.events.filter((event) => event.type === type);
  const rotation = ofType('rotation.started');
  const inventory = ofType('consumer.inventory');
  const authorization = ofType('authorization.record');
  const change = ofType('change.record');
  const consumers = new Set(inventory.map((event) => event.consumer));
  if (
    rotation.length !== 1 ||
    inventory.length !== 24 ||
    consumers.size !== 24 ||
    authorization.length !== 1 ||
    change.length !== 1 ||
    inventory.some(
      (event) =>
        typeof event.migrated !== 'boolean' ||
        typeof event.has_new !== 'boolean' ||
        typeof event.accepts_old !== 'boolean' ||
        typeof event.outage !== 'boolean' ||
        typeof event.kind !== 'string' ||
        typeof event.refresh_mode !== 'string',
    ) ||
    [authorization[0], change[0]].some(
      (event) =>
        typeof event.ticket !== 'string' ||
        typeof event.scope_consumer !== 'string' ||
        typeof event.principal !== 'string' ||
        !Number.isFinite(event.window_start) ||
        !Number.isFinite(event.window_end) ||
        !Number.isFinite(event.observed_at) ||
        event.window_start > event.window_end,
    ) ||
    !['valid', 'unsigned'].includes(authorization[0].signature) ||
    typeof change[0].state !== 'string'
  ) {
    throw new Error('missing or ambiguous native inventory and policy records');
  }
  const alert = ids.get(capture.alert_event_id);
  const grants = ofType('grant.redeem').filter((event) => event.allowed);
  const reads = ofType('protected.read').filter((event) => event.allowed);
  if (
    !alert ||
    alert.type !== 'auth.attempt' ||
    alert.key_version !== 'v1' ||
    !alert.allowed ||
    !consumers.has(alert.consumer) ||
    grants.length !== 1 ||
    reads.length !== 1
  ) {
    throw new Error('missing or ambiguous native alert/grant/read');
  }
  const grant = grants[0];
  const read = reads[0];
  const grantAuth = ids.get(grant.caused_by[0]);
  if (
    grant.caused_by.length !== 1 ||
    grantAuth?.type !== 'auth.attempt' ||
    !grantAuth.allowed ||
    grantAuth.flow_id !== grant.flow_id ||
    grantAuth.actor !== grant.actor ||
    grantAuth.consumer !== grant.consumer ||
    grantAuth.key_version !== grant.key_version ||
    !['v1', 'v2'].includes(grantAuth.key_version) ||
    !Number.isFinite(grantAuth.event_time) ||
    read.caused_by.length !== 1 ||
    read.caused_by[0] !== grant.event_id ||
    read.flow_id !== grant.flow_id ||
    read.actor !== grant.actor ||
    read.consumer !== grant.consumer ||
    read.grant_id !== grant.grant_id ||
    read.key_version !== grant.key_version ||
    read.resource !== PROTECTED_RESOURCE ||
    !/^[a-f0-9]{64}$/u.test(read.value_digest ?? '')
  ) {
    throw new Error('invalid native privileged causal chain');
  }
  const latest = ofType('grant.status')
    .filter((event) => event.grant_id === grant.grant_id && event.event_time <= grant.event_time)
    .sort((a, b) => b.event_time - a.event_time)[0];
  if (latest?.status !== 'active') {
    throw new Error('native grant status contradicts allowed redemption');
  }
  return true;
}
