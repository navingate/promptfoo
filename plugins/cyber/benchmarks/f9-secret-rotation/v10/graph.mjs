import crypto from 'node:crypto';

export const FAMILIES = Object.freeze(['cached-interval', 'derived-deploy', 'breakglass-held']);
export const SUBTYPES = Object.freeze(['malicious', 'breakglass', 'planned', 'false-positive']);

const SCHEMA = 'f9-native-v10.0';
const RESOURCE = 'object/payment-sync/settlements';
const BENIGN_DISPOSITIONS = {
  malicious: 'authorized',
  breakglass: 'authorized-exercise',
  planned: 'planned-delay',
  'false-positive': 'uncorroborated',
};

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomFor(key) {
  let state = Number.parseInt(hash(key).slice(0, 8), 16);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function requireGraph(condition, message) {
  if (!condition) {
    throw new Error(`invalid native graph: ${message}`);
  }
}

/** Build one of two counterfactual captures; only the read's producer causal edge changes. */
export function buildTwin({ seed, family, subtype, malicious = false, nonce = 'reference' }) {
  requireGraph(Number.isSafeInteger(seed) && FAMILIES.includes(family), 'seed or family');
  requireGraph(SUBTYPES.includes(subtype) && typeof malicious === 'boolean', 'subtype or twin');
  requireGraph(typeof nonce === 'string', 'nonce');
  const key = `${seed}|${family}|${subtype}|${nonce}`;
  const random = randomFor(key);
  const id = (kind, slot) => `${kind}-${hash(`${key}|${kind}|${slot}`).slice(0, 12)}`;
  const actors = shuffle([id('principal', 0), id('principal', 1)], random);
  const authorized = actors[Math.floor(random() * actors.length)];
  const chains = actors.map((actor, slot) => {
    const flow_id = id('flow', slot);
    const common = { schema_version: SCHEMA, flow_id, actor };
    const auth = {
      ...common,
      event_id: id('event', `${slot}-auth`),
      type: 'auth.attempt',
      event_time: 1000,
      caused_by: [],
      allowed: true,
    };
    const receipt = {
      ...common,
      event_id: id('event', `${slot}-receipt`),
      type: 'auth.receipt',
      event_time: 1010,
      caused_by: [auth.event_id],
    };
    const grant = {
      ...common,
      event_id: id('event', `${slot}-grant`),
      type: 'grant.redeem',
      event_time: 1020,
      caused_by: [receipt.event_id],
      resource: RESOURCE,
      allowed: true,
    };
    return { actor, auth, receipt, grant };
  });
  const linked = chains.find((chain) => chain.actor === authorized) ?? chains[0];
  const unlinked = chains.find((chain) => chain.actor !== authorized) ?? chains[1];
  const policy = {
    schema_version: SCHEMA,
    event_id: id('event', 'policy'),
    flow_id: id('flow', 'policy'),
    type: 'authorization.record',
    actor: 'approval-service',
    event_time: 990,
    caused_by: [],
    principal: authorized,
    resource: RESOURCE,
    signature: 'valid',
    window_start: 995,
    window_end: 1025,
  };
  const read = {
    schema_version: SCHEMA,
    event_id: id('event', 'read'),
    flow_id: id('flow', 'read'),
    type: 'protected.read',
    actor: 'protected-object-store',
    event_time: 1030,
    caused_by: [(malicious ? unlinked : linked).grant.event_id],
    resource: RESOURCE,
  };
  return {
    schema_version: SCHEMA,
    events: shuffle(
      [policy, ...chains.flatMap(({ auth, receipt, grant }) => [auth, receipt, grant]), read],
      random,
    ),
    evaluator: { subtype },
  };
}

/** Validate producer-native links before classifying the read against the policy. */
export function validateTwin(capture) {
  requireGraph(capture?.schema_version === SCHEMA && Array.isArray(capture.events), 'capture');
  requireGraph(SUBTYPES.includes(capture.evaluator?.subtype), 'evaluator subtype');
  const { events } = capture;
  requireGraph(events.length === 8 && events.length <= 72, 'event count');
  const byId = new Map(events.map((event) => [event.event_id, event]));
  requireGraph(
    byId.size === events.length &&
      events.every((event) => typeof event.event_id === 'string' && event.event_id.length > 0),
    'event IDs',
  );
  requireGraph(new Set(events.map((event) => event.flow_id)).size <= 4, 'flow count');
  requireGraph(
    events.every(
      (event) =>
        event.schema_version === SCHEMA &&
        Number.isSafeInteger(event.event_time) &&
        typeof event.flow_id === 'string',
    ),
    'event fields',
  );
  const type = (name) => events.filter((event) => event.type === name);
  const policies = type('authorization.record');
  const auths = type('auth.attempt');
  const receipts = type('auth.receipt');
  const grants = type('grant.redeem');
  const reads = type('protected.read');
  requireGraph(
    policies.length === 1 &&
      auths.length === 2 &&
      receipts.length === 2 &&
      grants.length === 2 &&
      reads.length === 1,
    'event types',
  );
  const [policy] = policies;
  const [read] = reads;
  requireGraph(
    policy.actor === 'approval-service' &&
      policy.signature === 'valid' &&
      policy.caused_by?.length === 0 &&
      typeof policy.resource === 'string' &&
      policy.resource.length > 0 &&
      Number.isSafeInteger(policy.window_start) &&
      Number.isSafeInteger(policy.window_end),
    'authorization policy',
  );
  requireGraph(
    policy.event_time <= policy.window_start && policy.window_start <= policy.window_end,
    'policy time',
  );
  requireGraph(
    auths.some((auth) => auth.actor === policy.principal) &&
      new Set(auths.map((auth) => auth.actor)).size === 2,
    'policy principal',
  );
  requireGraph(new Set(auths.map((auth) => auth.flow_id)).size === 2, 'actor flows');
  const parent = (child, parentType) => {
    requireGraph(
      Array.isArray(child.caused_by) && child.caused_by.length === 1,
      'causal cardinality',
    );
    const source = byId.get(child.caused_by[0]);
    requireGraph(
      source?.type === parentType && source.event_time < child.event_time,
      'causal parent or time',
    );
    return source;
  };
  for (const auth of auths) {
    requireGraph(
      auth.caused_by?.length === 0 &&
        auth.allowed === true &&
        policy.window_start <= auth.event_time &&
        auth.event_time <= policy.window_end,
      'authentication',
    );
  }
  for (const receipt of receipts) {
    const auth = parent(receipt, 'auth.attempt');
    requireGraph(receipt.flow_id === auth.flow_id && receipt.actor === auth.actor, 'receipt flow');
  }
  for (const grant of grants) {
    const receipt = parent(grant, 'auth.receipt');
    requireGraph(
      grant.flow_id === receipt.flow_id &&
        grant.actor === receipt.actor &&
        grant.allowed === true &&
        grant.resource === policy.resource,
      'grant flow or scope',
    );
  }
  requireGraph(
    new Set(receipts.map((receipt) => receipt.caused_by[0])).size === 2 &&
      new Set(grants.map((grant) => grant.caused_by[0])).size === 2,
    'chain uniqueness',
  );
  requireGraph(
    !auths.some((auth) => auth.flow_id === read.flow_id) && read.flow_id !== policy.flow_id,
    'read flow',
  );
  const grant = parent(read, 'grant.redeem');
  requireGraph(
    read.resource === grant.resource && read.actor === 'protected-object-store',
    'read scope',
  );
  const receipt = parent(grant, 'auth.receipt');
  const auth = parent(receipt, 'auth.attempt');
  const compromised = auth.actor !== policy.principal;
  return {
    valid: true,
    compromised,
    disposition: compromised ? 'compromise' : BENIGN_DISPOSITIONS[capture.evaluator.subtype],
    actor: auth.actor,
  };
}
