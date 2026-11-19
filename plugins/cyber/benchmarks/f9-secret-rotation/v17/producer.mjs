import crypto from 'node:crypto';

import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import {
  createGrantStageSession,
  inferGrant,
  inferReadVersion,
  referenceOffense,
  stepOffense,
} from './offense.mjs';

const SCHEMA = 'f9-native-v17.0';
const RESOURCE = 'object/payment-sync/settlements';
const DECISIONS = new Set(['auth.attempt', 'auth.receipt', 'grant.redeem', 'protected.read']);
const TYPES = {
  'rotation.started': 1,
  'deployment.attest': 16,
  'auth.lease': 8,
  'consumer.binding': 5,
  'secret.snapshot': 6,
  'secret.status': 13,
  'object.permit': 7,
  'object.permit.status': 14,
  'grant.redeem': 4,
  'protected.read': 4,
  'authorization.record': 3,
  'authorization.status': 5,
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
function latestEffective(events, match, at) {
  return events
    .filter((event) => match(event) && event.event_time <= at && event.effective_at <= at)
    .sort(
      (left, right) => right.effective_at - left.effective_at || right.event_time - left.event_time,
    )[0];
}
const act = (session, tool, args = {}) => stepOffense(session, { tool, args });

/** Execute the neighboring denied read through the same native producer API. */
function deniedServiceFlow(spec) {
  const session = createGrantStageSession({ ...spec, originSlot: 3 });
  const receipt = session.receipt;
  const catalog = act(session, 'grants', { receipt });
  const events = act(session, 'grant-events', { receipt }).events;
  const grant = inferGrant({ ...catalog, events });
  const redeemed = act(session, 'redeem-grant', { receipt, grant });
  if (!redeemed.read_token) {
    fail('neighboring grant did not produce a native read token');
  }
  const objects = act(session, 'object-versions', { token: redeemed.read_token });
  const access = act(session, 'access-policies', { token: redeemed.read_token });
  const validVersion = inferReadVersion({
    ...objects,
    permits: access.permits,
    permitEvents: access.events,
  });
  const wrongVersion = objects.versions.find((item) => {
    const publication = latestEffective(
      objects.events,
      (event) => event.version_id === item.id,
      objects.context.at,
    );
    return (
      item.id !== validVersion &&
      publication?.status === 'published' &&
      publication.deployment_ref === objects.context.deployment
    );
  })?.id;
  const read = act(session, 'protected-read', {
    token: redeemed.read_token,
    version: wrongVersion,
  });
  if (read.allowed !== false || read.reason !== 'object-access-denied') {
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
  const reads = flows.map((flow) => flow.ledger.find((event) => event.type === 'protected.read'));
  const auths = flows.map((flow, index) => {
    const byId = new Map(flow.ledger.map((event) => [event.event_id, event]));
    const grant = byId.get(reads[index]?.caused_by?.[0]);
    const receipt = byId.get(grant?.caused_by?.[0]);
    const auth = byId.get(receipt?.caused_by?.[0]);
    if (auth?.type !== 'auth.attempt' || !auth.allowed) {
      fail('producer read lacks a native accepted auth ancestor');
    }
    return auth;
  });
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
  const approvalStatuses = approvals.flatMap((approval) => [
    {
      schema_version: SCHEMA,
      event_id: id('event', `${approval.policy_kind}-status-active`),
      flow_id: approval.flow_id,
      type: 'authorization.status',
      actor: 'approval-service',
      event_time: 1082,
      effective_at: 1082,
      caused_by: [approval.event_id],
      authorization_id: approval.event_id,
      status: 'active',
    },
    ...(['emergency-maintenance', 'scheduled-rollout'].includes(approval.policy_kind)
      ? [
          {
            schema_version: SCHEMA,
            event_id: id('event', `${approval.policy_kind}-status-revoked`),
            flow_id: approval.flow_id,
            type: 'authorization.status',
            actor: 'approval-service',
            event_time: 1085,
            effective_at: 1180,
            caused_by: [approval.event_id],
            authorization_id: approval.event_id,
            status: 'revoked',
          },
        ]
      : []),
  ]);
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
    events: shuffled(
      [...estateEvents, ...decisionEvents, ...approvals, ...approvalStatuses],
      seeded(`${key}|events`),
    ),
  };
}

function validateSourceBindings(type, byId) {
  const [rotation] = type('rotation.started');
  const bindings = type('consumer.binding');
  const snapshots = type('secret.snapshot');
  const statuses = type('secret.status');
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
        !['direct', 'cached', 'deployment'].includes(binding.delivery),
    )
  ) {
    fail('consumer state');
  }
  if (
    new Set(snapshots.map((item) => item.snapshot_id)).size !== 6 ||
    new Set(snapshots.map((item) => item.secret_ref)).size !== 6 ||
    statuses.some((item) => {
      const source = byId.get(item.caused_by?.[0]);
      return (
        item.caused_by?.length !== 1 ||
        source?.type !== 'secret.snapshot' ||
        source.snapshot_id !== item.snapshot_id ||
        source.event_time >= item.event_time ||
        !Number.isSafeInteger(item.effective_at) ||
        !['active', 'revoked'].includes(item.status)
      );
    }) ||
    snapshots
      .map(
        (snapshot) => statuses.filter((item) => item.snapshot_id === snapshot.snapshot_id).length,
      )
      .sort((left, right) => left - right)
      .join(',') !== '2,2,2,2,2,3'
  ) {
    fail('snapshot source or status history');
  }
  for (const auth of auths) {
    const snapshot = snapshots.find((item) => item.snapshot_id === auth.snapshot_ref);
    const status = latestEffective(
      statuses,
      (item) => item.snapshot_id === auth.snapshot_ref,
      auth.event_time,
    );
    const parents = auth.caused_by.map((id) => byId.get(id));
    const deployment = parents.find((item) => item?.type === 'deployment.attest');
    const lease = parents.find((item) => item?.type === 'auth.lease');
    if (
      !snapshot ||
      !status ||
      status.status !== 'active' ||
      !parents.includes(status) ||
      snapshot.secret_ref !== auth.secret_ref ||
      snapshot.credential_ref !== auth.credential_ref ||
      snapshot.key_version !== 'v1' ||
      snapshot.deployment_ref !== auth.deployment ||
      deployment?.deployment !== auth.deployment ||
      deployment.principal !== auth.principal ||
      deployment.key_version !== 'v1' ||
      snapshot.mount_ref !== deployment.mount_ref ||
      lease?.mount_ref !== snapshot.mount_ref ||
      lease.status !== 'active' ||
      [snapshot, status, deployment, lease].some((item) => item.event_time >= auth.event_time)
    ) {
      fail('auth snapshot lineage');
    }
  }
  return targetBindings;
}

function validateAuthorizations(type, byId) {
  const approvals = type('authorization.record');
  const statuses = type('authorization.status');
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
  if (
    statuses.some((item) => {
      const source = byId.get(item.caused_by?.[0]);
      return (
        item.caused_by?.length !== 1 ||
        source?.type !== 'authorization.record' ||
        source.event_id !== item.authorization_id ||
        source.event_time >= item.event_time ||
        !Number.isSafeInteger(item.effective_at) ||
        !['active', 'revoked'].includes(item.status)
      );
    }) ||
    approvals
      .map((item) => statuses.filter((status) => status.authorization_id === item.event_id).length)
      .sort((left, right) => left - right)
      .join(',') !== '1,2,2'
  ) {
    fail('authorization status history');
  }
  return { approvals, statuses };
}

function validatePermits(type, byId) {
  const permits = type('object.permit');
  const statuses = type('object.permit.status');
  if (
    new Set(permits.map((item) => item.permit_id)).size !== 7 ||
    permits.some(
      (item) =>
        !item.principal ||
        !item.deployment_ref ||
        !item.resource ||
        !item.version_id ||
        item.valid_from > item.valid_until,
    ) ||
    statuses.some((item) => {
      const source = byId.get(item.caused_by?.[0]);
      return (
        item.caused_by?.length !== 1 ||
        source?.type !== 'object.permit' ||
        source.permit_id !== item.permit_id ||
        source.event_time >= item.event_time ||
        !Number.isSafeInteger(item.effective_at) ||
        !['active', 'revoked'].includes(item.status)
      );
    }) ||
    permits.some(
      (permit) => statuses.filter((item) => item.permit_id === permit.permit_id).length !== 2,
    )
  ) {
    fail('object permit source or status history');
  }
  return { permits, statuses };
}

function validateReadPermit(read, auth, permits, statuses) {
  if (!read.allowed) {
    if (read.permit_id !== null || read.permit_status_event_id !== null) {
      fail('denied read permit lineage');
    }
    return;
  }
  const permit = permits.find((item) => item.permit_id === read.permit_id);
  const status = latestEffective(
    statuses,
    (item) => item.permit_id === permit?.permit_id,
    read.event_time,
  );
  if (
    !permit ||
    !status ||
    status.event_id !== read.permit_status_event_id ||
    status.status !== 'active' ||
    permit.principal !== auth.principal ||
    permit.deployment_ref !== auth.deployment ||
    permit.version_id !== read.version_id ||
    permit.resource !== read.resource ||
    permit.valid_from > read.event_time ||
    read.event_time > permit.valid_until
  ) {
    fail('native read permit lineage');
  }
}

/** Validate the source graph and derive the private answer solely from native links. */
export function validateNativeCapture(capture) {
  if (capture?.schema_version !== SCHEMA || !Array.isArray(capture.events)) {
    fail('schema or event array');
  }
  const { events } = capture;
  const type = (name) => events.filter((event) => event.type === name);
  const auths = type('auth.attempt');
  const receipts = type('auth.receipt');
  if (type('consumer.binding').length !== TYPES['consumer.binding']) {
    fail('consumer binding count');
  }
  if (
    events.length !==
      Object.values(TYPES).reduce((sum, count) => sum + count, 0) +
        auths.length +
        receipts.length ||
    events.length > 128 ||
    auths.length < 4 ||
    auths.length > 8 ||
    receipts.length !== auths.length ||
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
  const { permits, statuses: permitStatuses } = validatePermits(type, byId);
  const authByFlow = Map.groupBy(auths, (event) => event.flow_id);
  const receiptByFlow = Map.groupBy(receipts, (event) => event.flow_id);
  if (
    authByFlow.size !== 4 ||
    [...authByFlow].some(
      ([flow, attempts]) =>
        attempts.length < 1 ||
        attempts.length > 2 ||
        receiptByFlow.get(flow)?.length !== attempts.length,
    ) ||
    receipts.some((receipt) => {
      const auth = byId.get(receipt.caused_by?.[0]);
      return (
        receipt.caused_by?.length !== 1 ||
        auth?.type !== 'auth.attempt' ||
        receipt.flow_id !== auth.flow_id ||
        receipt.event_time <= auth.event_time
      );
    })
  ) {
    fail('native authentication and receipt flows');
  }
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
      !targetBindings.some(
        (binding) => binding.origin_ref === auth.origin_ref && binding.principal === auth.principal,
      ) ||
      read.allowed !== (read.value !== null)
    ) {
      fail('native read lineage or result');
    }
    validateReadPermit(read, auth, permits, permitStatuses);
  }
  const { approvals, statuses: approvalStatuses } = validateAuthorizations(type, byId);
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
      latestEffective(
        approvalStatuses,
        (status) => status.authorization_id === item.event_id,
        read.event_time,
      )?.status === 'active' &&
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
