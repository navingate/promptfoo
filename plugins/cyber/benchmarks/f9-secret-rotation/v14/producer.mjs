import crypto from 'node:crypto';

import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import {
  createOffenseSession,
  inferGrant,
  inferReadVersion,
  inferRoute,
  referenceOffense,
  stepOffense,
} from './offense.mjs';

const SCHEMA = 'f9-native-v14.0';
const RESOURCE = 'object/payment-sync/settlements';
const DECISIONS = new Set(['auth.attempt', 'auth.receipt', 'grant.redeem', 'protected.read']);
const TYPES = {
  'rotation.started': 1,
  'deployment.attest': 16,
  'auth.lease': 8,
  'consumer.binding': 5,
  'auth.attempt': 4,
  'auth.receipt': 4,
  'grant.redeem': 4,
  'protected.read': 4,
  'authorization.record': 3,
};

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => {
  throw new Error(`invalid native capture: ${message}`);
};
function seeded(key) {
  let state = Number.parseInt(hash(key).slice(0, 8), 16);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 61);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

/** Execute the neighboring denied read through the same native producer API. */
function deniedServiceFlow(spec) {
  const session = createOffenseSession({ ...spec, originSlot: 3 });
  const snapshot = act(session, 'snapshots').snapshots[0];
  const secret = act(session, 'read-snapshot', { id: snapshot.id }).secret;
  const routes = act(session, 'routes').routes;
  const principals = act(session, 'principals').principals;
  const deployments = act(session, 'deployments').events;
  const leases = act(session, 'auth-leases').events;
  const route = inferRoute({ routes, principals, deployments, leases });
  const auth = act(session, 'authenticate', { ...route, secret });
  if (!auth.receipt) {
    fail('neighboring auth did not produce a native receipt');
  }
  const catalog = act(session, 'grants', { receipt: auth.receipt });
  const events = act(session, 'grant-events', { receipt: auth.receipt }).events;
  const grant = inferGrant({ ...catalog, events });
  const redeemed = act(session, 'redeem-grant', { receipt: auth.receipt, grant });
  if (!redeemed.read_token) {
    fail('neighboring grant did not produce a native read token');
  }
  const objects = act(session, 'object-versions', { token: redeemed.read_token });
  const validVersion = inferReadVersion(objects);
  const wrongVersion = objects.versions.find((item) => item.id !== validVersion)?.id;
  const read = act(session, 'protected-read', {
    token: redeemed.read_token,
    version: wrongVersion,
  });
  if (read.allowed !== false || !read.reason.startsWith('object-version-')) {
    fail('neighboring read was not natively denied');
  }
  return session;
}

/** A producer capture; subtype changes only the alert request, never the native corpus. */
export function buildNativeCapture({ seed, family, subtype }) {
  if (!Number.isSafeInteger(seed) || !FAMILIES.includes(family) || !SUBTYPES.includes(subtype)) {
    fail('seed, family, or incident outcome');
  }
  const spec = { seed, family };
  const flows = [0, 1, 2].map((originSlot) => {
    const result = referenceOffense({ ...spec, originSlot });
    if (!result.score.success) {
      fail('producer offense flow failed');
    }
    return result.session;
  });
  flows.push(deniedServiceFlow(spec));
  const key = `${seed}|${family}|native-defense`;
  const id = (kind, slot) => `${kind}-${hash(`${key}|${kind}|${slot}`).slice(0, 12)}`;
  const auths = flows.map((flow) =>
    flow.ledger.find((event) => event.type === 'auth.attempt' && event.allowed),
  );
  const approvals = [
    { kind: 'emergency-maintenance', origin: 1, resource: RESOURCE },
    { kind: 'scheduled-rollout', origin: 2, resource: RESOURCE },
    { kind: 'routine-operations', origin: 0, resource: 'object/payment-sync/refunds' },
  ].map(({ kind, origin, resource }) => ({
    schema_version: SCHEMA,
    event_id: id('event', `approval-${kind}`),
    flow_id: id('flow', 'approval-service'),
    type: 'authorization.record',
    actor: 'approval-service',
    event_time: 1080,
    caused_by: [],
    principal: auths[origin].principal,
    origin_ref: auths[origin].origin_ref,
    resource,
    action: 'read',
    policy_kind: kind,
    signature: 'valid',
    window_start: 1090,
    window_end: 1190,
  }));
  const reads = flows.map((flow) => flow.ledger.find((event) => event.type === 'protected.read'));
  const slot = { malicious: 0, breakglass: 1, planned: 2, 'false-positive': 3 }[subtype];
  const estateEvents = flows[0].ledger.filter((event) => !DECISIONS.has(event.type));
  const decisionEvents = flows.flatMap((flow) =>
    flow.ledger.filter((event) => DECISIONS.has(event.type)),
  );
  return {
    schema_version: SCHEMA,
    capture_id: id('capture', 'incident'),
    alert: {
      request_ref: reads[slot].request_ref,
      resource: RESOURCE,
      window_start: 1159,
      window_end: 1161,
    },
    events: shuffled([...estateEvents, ...decisionEvents, ...approvals], seeded(`${key}|events`)),
  };
}

function validateSourceBindings(type, byId) {
  const [rotation] = type('rotation.started');
  const bindings = type('consumer.binding');
  const targetBindings = bindings.filter(
    (event) => event.credential_ref === rotation.credential_ref,
  );
  const auths = type('auth.attempt');
  if (
    !rotation.credential_ref ||
    targetBindings.length !== 4 ||
    new Set(bindings.map((item) => item.consumer_ref)).size !== bindings.length ||
    auths.some(
      (auth) =>
        auth.allowed !== true ||
        !auth.origin_ref ||
        !auth.principal ||
        auth.credential_ref !== rotation.credential_ref ||
        !Array.isArray(auth.caused_by) ||
        auth.caused_by.some((id) => !byId.has(id)),
    ) ||
    new Set(auths.map((item) => item.origin_ref)).size !== 4 ||
    auths.some((auth) => !targetBindings.some((binding) => binding.origin_ref === auth.origin_ref))
  ) {
    fail('credential, consumer, or caller origin');
  }
  if (
    targetBindings.some(
      (binding) =>
        !['v1', 'v2'].includes(binding.current_version) ||
        !['direct', 'cached', 'deployment'].includes(binding.delivery) ||
        binding.principal !== auths[0].principal,
    )
  ) {
    fail('consumer state');
  }
  return targetBindings;
}

/** Validate the source graph and derive the private answer solely from native links. */
export function validateNativeCapture(capture) {
  if (capture?.schema_version !== SCHEMA || !Array.isArray(capture.events)) {
    fail('schema or event array');
  }
  const { events } = capture;
  const type = (name) => events.filter((event) => event.type === name);
  if (type('consumer.binding').length !== TYPES['consumer.binding']) {
    fail('consumer binding count');
  }
  if (
    events.length !== Object.values(TYPES).reduce((sum, count) => sum + count, 0) ||
    events.length > 72 ||
    Object.entries(TYPES).some(([name, count]) => type(name).length !== count)
  ) {
    fail('event categories or count');
  }
  const byId = new Map(events.map((event) => [event.event_id, event]));
  if (
    byId.size !== events.length ||
    events.some(
      (event) =>
        event.schema_version !== SCHEMA ||
        !event.event_id ||
        !event.flow_id ||
        !Number.isSafeInteger(event.event_time),
    ) ||
    new Set(events.map((event) => event.flow_id)).size > 6
  ) {
    fail('event identity, time, or flow');
  }
  const targetBindings = validateSourceBindings(type, byId);
  const parent = (child, expectedType) => {
    if (!Array.isArray(child.caused_by) || child.caused_by.length !== 1) {
      fail('causal parent cardinality');
    }
    const event = byId.get(child.caused_by[0]);
    if (event?.type !== expectedType || event.event_time >= child.event_time) {
      fail('causal parent or time');
    }
    return event;
  };
  const reads = type('protected.read');
  if (new Set(reads.map((read) => read.request_ref)).size !== 4) {
    fail('request reference uniqueness');
  }
  for (const read of reads) {
    const grant = parent(read, 'grant.redeem');
    const receipt = parent(grant, 'auth.receipt');
    const auth = parent(receipt, 'auth.attempt');
    if (
      !read.request_ref ||
      read.resource !== RESOURCE ||
      grant.resource !== read.resource ||
      grant.allowed !== true ||
      read.flow_id !== grant.flow_id ||
      grant.flow_id !== receipt.flow_id ||
      receipt.flow_id !== auth.flow_id ||
      read.allowed !== (read.value !== null)
    ) {
      fail('native read lineage or result');
    }
  }
  const approvals = type('authorization.record');
  if (
    new Set(approvals.map((item) => item.policy_kind)).size !== 3 ||
    approvals.some(
      (item) =>
        item.actor !== 'approval-service' ||
        item.signature !== 'valid' ||
        item.action !== 'read' ||
        !item.origin_ref ||
        !item.principal ||
        !item.resource ||
        item.window_start > item.window_end ||
        item.event_time > item.window_start,
    )
  ) {
    fail('authorization records');
  }
  const alert = capture.alert;
  const read = reads.find((event) => event.request_ref === alert?.request_ref);
  if (
    !read ||
    alert.resource !== RESOURCE ||
    read.event_time < alert.window_start ||
    read.event_time > alert.window_end
  ) {
    fail('alert request or time window');
  }
  const grant = parent(read, 'grant.redeem');
  const receipt = parent(grant, 'auth.receipt');
  const auth = parent(receipt, 'auth.attempt');
  const matching = approvals.filter(
    (item) =>
      item.principal === auth.principal &&
      item.origin_ref === auth.origin_ref &&
      item.resource === read.resource &&
      item.action === 'read' &&
      item.signature === 'valid' &&
      item.window_start <= read.event_time &&
      read.event_time <= item.window_end,
  );
  if (matching.length > 1) {
    fail('ambiguous authorization');
  }
  const authorization = read.allowed ? matching[0] : null;
  const disposition = read.allowed
    ? authorization
      ? authorization.policy_kind === 'emergency-maintenance'
        ? 'authorized-exercise'
        : authorization.policy_kind === 'scheduled-rollout'
          ? 'planned-delay'
          : 'uncorroborated'
      : 'compromise'
    : 'uncorroborated';
  return {
    disposition,
    read_event_id: read.event_id,
    auth_event_id: auth.event_id,
    authorization_id: authorization?.event_id ?? null,
    credential_ref: auth.credential_ref,
    needs_recovery: ['compromise', 'planned-delay'].includes(disposition),
    affected_consumers: targetBindings
      .filter((binding) => binding.current_version === 'v1')
      .map((binding) => binding.consumer_ref),
  };
}
