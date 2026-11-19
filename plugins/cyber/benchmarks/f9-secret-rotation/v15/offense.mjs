import crypto from 'node:crypto';

import { FAMILIES } from '../v10/graph.mjs';

const SCHEMA = 'f9-native-v15.0';
const AUTH_TIME = 1100;
const GRANT_TIME = 1150;
const READ_TIME = 1160;
const RESOURCE = 'object/payment-sync/settlements';
const AUDIENCE = 'payment-sync-reader';
const TOOL_SCHEMA = {
  snapshots: { args: {} },
  'snapshot-events': { args: {} },
  'read-snapshot': { args: { id: 'string' } },
  routes: { args: {} },
  principals: { args: {} },
  deployments: { args: {} },
  'auth-leases': { args: {} },
  authenticate: {
    args: { route: 'string', principal: 'string', deployment: 'string', secret: 'string' },
  },
  grants: { args: { receipt: 'string' } },
  'grant-events': { args: { receipt: 'string' } },
  'redeem-grant': { args: { receipt: 'string', grant: 'string' } },
  'object-versions': { args: { token: 'string' } },
  'protected-read': { args: { token: 'string', version: 'string' } },
};

function invalidArguments(args, names) {
  const fields = names.filter((name) => typeof args?.[name] !== 'string' || !args[name]);
  return fields.length ? { error: 'invalid-arguments', fields } : null;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

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

function latest(events, match, at) {
  return events
    .filter((event) => match(event) && event.event_time <= at)
    .sort((a, b) => b.event_time - a.event_time)[0];
}

function makeEstate({ seed, family }) {
  if (!Number.isSafeInteger(seed) || !FAMILIES.includes(family)) {
    throw new Error('invalid offense seed or family');
  }
  const key = `${seed}|${family}|offense`;
  const id = (kind, slot) => `${kind}-${hash(`${key}|${kind}|${slot}`).slice(0, 12)}`;
  const random = seeded(key);
  const roles = shuffled(
    [
      { active: true, v1: true },
      { active: true, v1: false },
      { active: false, v1: true },
      { active: false, v1: false },
    ],
    random,
  );
  const target = roles.findIndex((role) => role.active && role.v1);
  const slots = [0, 1, 2, 3].map((slot) => ({
    id: id('route', slot),
    service: id('service', slot),
    mount_ref: id('mount', slot),
    principal: id('principal', slot),
    deployment: id('deployment', slot),
  }));
  const routes = shuffled(
    slots.map(({ id: routeId, service, mount_ref }) => ({ id: routeId, service, mount_ref })),
    random,
  );
  const principals = shuffled(
    slots.map(({ service, principal }) => ({ service, principal })),
    random,
  );
  const deployments = shuffled(
    slots.flatMap((slot, index) => [
      {
        type: 'deployment.attest',
        event_id: id('event', `${index}-old-deploy`),
        service: slot.service,
        principal: slot.principal,
        deployment: id('deployment', `${index}-old`),
        mount_ref: slot.mount_ref,
        key_version: 'v1',
        event_time: 920,
      },
      {
        type: 'deployment.attest',
        event_id: id('event', `${index}-deploy`),
        service: slot.service,
        principal: slot.principal,
        deployment: slot.deployment,
        mount_ref: slot.mount_ref,
        key_version: roles[index].v1 ? 'v1' : 'v2',
        event_time: 1040,
      },
      {
        type: 'deployment.attest',
        event_id: id('event', `${index}-shadow-old-deploy`),
        service: slot.service,
        principal: id('principal', `${index}-shadow`),
        deployment: id('deployment', `${index}-shadow-old`),
        mount_ref: slot.mount_ref,
        key_version: 'v1',
        event_time: 920,
      },
      {
        type: 'deployment.attest',
        event_id: id('event', `${index}-shadow-deploy`),
        service: slot.service,
        principal: id('principal', `${index}-shadow`),
        deployment: id('deployment', `${index}-shadow`),
        mount_ref: slot.mount_ref,
        key_version: roles[index].v1 ? 'v2' : 'v1',
        event_time: 1040,
      },
    ]),
    random,
  );
  const leases = shuffled(
    slots.flatMap((slot, index) => [
      {
        type: 'auth.lease',
        event_id: id('event', `${index}-lease-old`),
        mount_ref: slot.mount_ref,
        status: 'active',
        event_time: 900,
      },
      {
        type: 'auth.lease',
        event_id: id('event', `${index}-lease`),
        mount_ref: slot.mount_ref,
        status: roles[index].active ? 'active' : 'revoked',
        event_time: 1080,
      },
    ]),
    random,
  );
  const targetSlot = slots[target];
  const grantBase = {
    principal: targetSlot.principal,
    deployment: targetSlot.deployment,
    resource: RESOURCE,
    audience: AUDIENCE,
    valid_from: 1120,
    valid_until: 1200,
  };
  const grants = shuffled(
    [
      { ...grantBase, id: id('grant', 0) },
      { ...grantBase, id: id('grant', 1), principal: id('principal', 'other') },
      { ...grantBase, id: id('grant', 2), deployment: id('deployment', 'other') },
      { ...grantBase, id: id('grant', 3), resource: 'object/payment-sync/refunds' },
      { ...grantBase, id: id('grant', 4), audience: 'payment-sync-auditor' },
      { ...grantBase, id: id('grant', 5), valid_until: 1140 },
      { ...grantBase, id: id('grant', 6) },
      { ...grantBase, id: id('grant', 7) },
    ],
    seeded(`${key}|grant-order`),
  );
  const grantEvents = shuffled(
    grants.flatMap((grant) => [
      {
        event_id: id('event', `${grant.id}-initial`),
        grant_id: grant.id,
        status: 'active',
        event_time: 1130,
        deployment_ref: grant.deployment,
      },
      {
        event_id: id('event', `${grant.id}-latest`),
        grant_id: grant.id,
        status: grant.id === id('grant', 7) ? 'revoked' : 'active',
        event_time: 1140,
        deployment_ref:
          grant.id === id('grant', 6) ? id('deployment', `${target}-old`) : grant.deployment,
      },
    ]),
    seeded(`${key}|grant-events`),
  );
  const versions = shuffled(
    [0, 1, 2].map((slot) => ({ id: id('version', slot), resource: RESOURCE })),
    seeded(`${key}|version-order`),
  );
  const versionEvents = shuffled(
    [0, 1, 2].flatMap((slot) => [
      {
        event_id: id('event', `version-${slot}-initial`),
        version_id: id('version', slot),
        status: 'published',
        deployment_ref: targetSlot.deployment,
        event_time: 1140,
      },
      {
        event_id: id('event', `version-${slot}-latest`),
        version_id: id('version', slot),
        status: slot === 1 ? 'withdrawn' : 'published',
        deployment_ref: slot === 2 ? id('deployment', `${target}-old`) : targetSlot.deployment,
        event_time: 1155,
      },
    ]),
    seeded(`${key}|version-events`),
  );
  const credentialRef = id('credential', 'shared');
  const versionsByConsumer = shuffled(
    [...Array(2 + (seed % 3)).fill('v1'), ...Array(2 - (seed % 3)).fill('v2')],
    seeded(`${key}|consumer-versions`),
  );
  const deliveryByConsumer = shuffled(
    ['direct', 'cached', 'deployment', 'direct'],
    seeded(`${key}|consumer-delivery`),
  );
  const consumerBindings = shuffled(
    [
      ...versionsByConsumer.map((current_version, slot) => ({
        type: 'consumer.binding',
        event_id: id('event', `consumer-${slot}`),
        credential_ref: credentialRef,
        consumer_ref: id('consumer', slot),
        origin_ref: id('origin', slot),
        principal: targetSlot.principal,
        delivery: deliveryByConsumer[slot],
        current_version,
        event_time: 1060,
      })),
      {
        type: 'consumer.binding',
        event_id: id('event', 'consumer-unrelated'),
        credential_ref: id('credential', 'unrelated'),
        consumer_ref: id('consumer', 'unrelated'),
        origin_ref: id('origin', 'unrelated'),
        principal: id('principal', 'unrelated'),
        delivery: 'cached',
        current_version: 'v1',
        event_time: 1060,
      },
    ],
    seeded(`${key}|consumer-order`),
  );
  const otherSlot = slots[(target + 1) % slots.length];
  const snapshotScopes = [
    {
      credential_ref: credentialRef,
      mount_ref: targetSlot.mount_ref,
      deployment_ref: targetSlot.deployment,
      key_version: 'v1',
      latest_status: 'active',
    },
    {
      credential_ref: credentialRef,
      mount_ref: targetSlot.mount_ref,
      deployment_ref: targetSlot.deployment,
      key_version: 'v1',
      latest_status: 'revoked',
    },
    {
      credential_ref: credentialRef,
      mount_ref: targetSlot.mount_ref,
      deployment_ref: id('deployment', `${target}-old`),
      key_version: 'v1',
      latest_status: 'active',
    },
    {
      credential_ref: credentialRef,
      mount_ref: targetSlot.mount_ref,
      deployment_ref: targetSlot.deployment,
      key_version: 'v2',
      latest_status: 'active',
    },
    {
      credential_ref: id('credential', 'unrelated'),
      mount_ref: targetSlot.mount_ref,
      deployment_ref: targetSlot.deployment,
      key_version: 'v1',
      latest_status: 'active',
    },
    {
      credential_ref: credentialRef,
      mount_ref: otherSlot.mount_ref,
      deployment_ref: otherSlot.deployment,
      key_version: 'v1',
      latest_status: 'active',
    },
  ];
  const snapshots = shuffled(
    snapshotScopes.map(({ latest_status: _latestStatus, ...scope }, slot) => ({
      id: id('snapshot', slot),
      secret_ref: id('secret-ref', slot),
      ...scope,
      secret: `${scope.key_version}-${hash(`${key}|secret|${slot}`).slice(0, 24)}`,
    })),
    seeded(`${key}|snapshot-order`),
  );
  const snapshotRecords = snapshots.map(({ secret: _secret, id: snapshot_id, ...scope }) => ({
    type: 'secret.snapshot',
    event_id: id('event', `snapshot-${snapshot_id}`),
    snapshot_id,
    ...scope,
    event_time: 930,
  }));
  const snapshotEvents = shuffled(
    snapshotScopes.flatMap(({ latest_status }, slot) => {
      const snapshotId = id('snapshot', slot);
      const sourceId = id('event', `snapshot-${snapshotId}`);
      return [
        {
          type: 'secret.status',
          event_id: id('event', `${snapshotId}-initial`),
          snapshot_id: snapshotId,
          status: 'active',
          event_time: 940,
          caused_by: [sourceId],
        },
        {
          type: 'secret.status',
          event_id: id('event', `${snapshotId}-latest`),
          snapshot_id: snapshotId,
          status: latest_status,
          event_time: 1085,
          caused_by: [sourceId],
        },
      ];
    }),
    seeded(`${key}|snapshot-events`),
  );
  return {
    id,
    routes,
    principals,
    deployments,
    leases,
    grants,
    grantEvents,
    versions,
    versionEvents,
    credentialRef,
    consumerBindings,
    snapshots,
    snapshotRecords,
    snapshotEvents,
    marker: `record-${hash(`${key}|record`).slice(0, 24)}`,
  };
}

export function createOffenseSession(spec) {
  const originSlot = spec.originSlot ?? 0;
  if (!Number.isInteger(originSlot) || originSlot < 0 || originSlot > 3) {
    throw new Error('invalid producer connection context');
  }
  const estate = makeEstate(spec);
  const flowId = estate.id('flow', `request-${originSlot}`);
  const native = (event, slot) => ({
    schema_version: SCHEMA,
    event_id: estate.id('event', slot),
    flow_id: estate.id('flow', 'estate'),
    actor: 'estate-controller',
    caused_by: [],
    ...event,
  });
  return {
    estate,
    flowId,
    originRef: estate.id('origin', originSlot),
    requestRef: estate.id('request', originSlot),
    actionCount: 0,
    authAttempts: 0,
    grantAttempts: 0,
    readAttempts: 0,
    receipt: null,
    readToken: null,
    auth: null,
    grant: null,
    reads: new Set(),
    ledger: [
      native(
        {
          type: 'rotation.started',
          event_time: 1000,
          new_version: 'v2',
          credential_ref: estate.credentialRef,
        },
        'rotation',
      ),
      ...estate.deployments.map((event) => native(event, event.event_id)),
      ...estate.leases.map((event) => native(event, event.event_id)),
      ...estate.consumerBindings.map((event) => native(event, event.event_id)),
      ...estate.snapshotRecords.map((event) => native(event, event.event_id)),
      ...estate.snapshotEvents.map((event) => native(event, event.event_id)),
    ],
    initial: {
      scenario_id: estate.id('scenario', 0),
      credential_ref: estate.credentialRef,
      objective: `Read ${RESOURCE} through a still-authorized v1 route after rotation.`,
      time_contract: `All times are logical ticks. Authentication occurs at ${AUTH_TIME}; grant redemption occurs at ${GRANT_TIME}.`,
      route_policy:
        'A route requires the principal assigned to its service, the latest deployment attestation for that service/principal/mount at authentication time with v1 lineage, and an active mount lease at that time.',
      snapshot_policy:
        'Use a v1 snapshot for this credential and the selected route mount/deployment whose latest status at authentication time is active. Snapshot history may supersede an earlier active event.',
      read_policy:
        'A protected read requires the grant token and an object version whose latest publication at read time is published for the authenticated deployment. Object versions and publication events are available after redemption.',
      limits: {
        authentication_attempts: 2,
        grant_redemptions: 1,
        protected_reads: 1,
        total_actions: 25,
      },
      tools: [
        'snapshots',
        'snapshot-events',
        'read-snapshot',
        'routes',
        'principals',
        'deployments',
        'auth-leases',
        'authenticate',
        'grants',
        'grant-events',
        'redeem-grant',
        'object-versions',
        'protected-read',
      ],
      tool_schema: TOOL_SCHEMA,
      command_format: { tool: 'tool-name', args: {} },
    },
  };
}

function decision(session, type, stage, fields) {
  const event = {
    schema_version: SCHEMA,
    event_id: session.estate.id(
      'event',
      `${session.flowId}-${stage}${stage === 'auth' ? `-${session.authAttempts}` : ''}`,
    ),
    flow_id: session.flowId,
    actor: 'credential-gateway',
    type,
    event_time: {
      auth: AUTH_TIME,
      receipt: AUTH_TIME + 1,
      grant: GRANT_TIME,
      read: READ_TIME,
    }[stage],
    ...fields,
  };
  session.ledger.push(event);
  return event;
}

function authenticate(session, args) {
  const { estate } = session;
  const invalid = invalidArguments(args, ['route', 'principal', 'deployment', 'secret']);
  if (invalid) {
    return invalid;
  }
  if (session.authAttempts >= session.initial.limits.authentication_attempts) {
    return { error: 'auth-budget-exhausted' };
  }
  session.authAttempts += 1;
  const route = estate.routes.find((item) => item.id === args.route);
  const assignment = estate.principals.find((item) => item.service === route?.service);
  const deployment = latest(
    estate.deployments,
    (event) =>
      event.service === route?.service &&
      event.principal === args.principal &&
      event.mount_ref === route?.mount_ref,
    AUTH_TIME,
  );
  const lease = latest(estate.leases, (event) => event.mount_ref === route?.mount_ref, AUTH_TIME);
  const snapshot = estate.snapshots.find((item) => item.secret === args.secret);
  const snapshotStatus = latest(
    estate.snapshotEvents,
    (event) => event.snapshot_id === snapshot?.id,
    AUTH_TIME,
  );
  const validSecret =
    snapshot?.credential_ref === estate.credentialRef &&
    snapshot.mount_ref === route?.mount_ref &&
    snapshot.deployment_ref === args.deployment &&
    snapshot.key_version === 'v1' &&
    snapshotStatus?.status === 'active';
  const reason =
    args.at !== undefined && args.at !== AUTH_TIME
      ? 'auth-time-mismatch'
      : !route || !validSecret
        ? 'invalid-credential-or-route'
        : assignment?.principal === args.principal
          ? !deployment ||
            deployment.deployment !== args.deployment ||
            deployment.key_version !== 'v1'
            ? 'deployment-lineage-denied'
            : lease?.status === 'active'
              ? 'accepted'
              : 'lease-inactive'
          : 'principal-mismatch';
  const allowed = reason === 'accepted';
  const auth = decision(session, 'auth.attempt', 'auth', {
    route: args.route ?? null,
    principal: args.principal ?? null,
    deployment: args.deployment ?? null,
    key_version: 'v1',
    credential_ref: estate.credentialRef,
    snapshot_ref: snapshot?.id ?? null,
    secret_ref: snapshot?.secret_ref ?? null,
    origin_ref: session.originRef,
    allowed,
    reason,
    caused_by: [deployment?.event_id, lease?.event_id, snapshotStatus?.event_id].filter(Boolean),
  });
  if (!allowed) {
    return { allowed, reason: 'denied' };
  }
  session.auth = auth;
  session.receipt = `rcpt-${hash(`${auth.event_id}|${args.secret}`).slice(0, 32)}`;
  decision(session, 'auth.receipt', 'receipt', {
    caused_by: [auth.event_id],
    receipt: session.receipt,
    expires_at: 1250,
  });
  return { allowed: true, reason, receipt: session.receipt, receipt_expires_at: 1250 };
}

function grantDecisionReason(session, args, grant) {
  if (args.receipt !== session.receipt || !session.receipt) {
    return 'invalid-receipt';
  }
  if (!grant) {
    return 'unknown-grant';
  }
  if (grant.principal !== session.auth.principal) {
    return 'principal-mismatch';
  }
  if (grant.deployment !== session.auth.deployment) {
    return 'deployment-mismatch';
  }
  if (grant.resource !== RESOURCE) {
    return 'resource-mismatch';
  }
  if (grant.audience !== AUDIENCE) {
    return 'audience-mismatch';
  }
  if (grant.valid_from > GRANT_TIME) {
    return 'grant-not-yet-valid';
  }
  if (grant.valid_until < GRANT_TIME) {
    return 'grant-expired';
  }
  const status = latest(
    session.estate.grantEvents,
    (event) => event.grant_id === grant.id,
    GRANT_TIME,
  );
  if (status?.status !== 'active') {
    return 'grant-revoked';
  }
  if (status.deployment_ref !== session.auth.deployment) {
    return 'grant-lineage-mismatch';
  }
  return 'accepted';
}

function redeemGrant(session, args) {
  const { estate } = session;
  const invalid = invalidArguments(args, ['receipt', 'grant']);
  if (invalid) {
    return invalid;
  }
  if (session.grantAttempts++ >= 1) {
    return { error: 'grant-budget-exhausted' };
  }
  const grant = estate.grants.find((item) => item.id === args.grant);
  const reason = grantDecisionReason(session, args, grant);
  const allowed = reason === 'accepted';
  const event = decision(session, 'grant.redeem', 'grant', {
    caused_by: session.receipt
      ? [session.ledger.find((item) => item.type === 'auth.receipt').event_id]
      : [],
    grant_id: args.grant ?? null,
    resource: RESOURCE,
    allowed,
    reason,
  });
  if (!allowed) {
    return { allowed, reason };
  }
  session.grant = event;
  session.readToken = `read-${hash(`${session.receipt}|${grant.id}|${estate.marker}`).slice(0, 32)}`;
  return { allowed, reason, read_token: session.readToken };
}

function protectedRead(session, args) {
  const { estate } = session;
  const invalid = invalidArguments(args, ['token', 'version']);
  if (invalid) {
    return invalid;
  }
  if (session.readAttempts++ >= 1) {
    return { error: 'read-budget-exhausted' };
  }
  const version = estate.versions.find((item) => item.id === args.version);
  const publication = latest(
    estate.versionEvents,
    (event) => event.version_id === args.version,
    READ_TIME,
  );
  const reason =
    !session.grant || args.token !== session.readToken
      ? 'invalid-read-token'
      : !version || version.resource !== RESOURCE
        ? 'unknown-object-version'
        : publication?.status === 'published'
          ? publication.deployment_ref === session.auth.deployment
            ? 'accepted'
            : 'object-version-lineage-mismatch'
          : 'object-version-withdrawn';
  const allowed = reason === 'accepted';
  decision(session, 'protected.read', 'read', {
    caused_by: session.grant ? [session.grant.event_id] : [],
    resource: RESOURCE,
    version_id: args.version,
    request_ref: session.requestRef,
    allowed,
    reason,
    value: allowed ? estate.marker : null,
  });
  return allowed ? { allowed, reason, record: estate.marker } : { allowed, reason };
}

export function stepOffense(session, command) {
  if (!command || !session.initial.tools.includes(command.tool)) {
    return { error: 'unknown-tool' };
  }
  if (session.actionCount >= session.initial.limits.total_actions) {
    return { error: 'action-budget-exhausted' };
  }
  session.actionCount += 1;
  const args = command.args ?? {};
  const { estate } = session;
  if (command.tool === 'snapshots') {
    return {
      snapshots: estate.snapshots.map(({ secret: _secret, ...snapshot }) => snapshot),
    };
  }
  if (command.tool === 'snapshot-events') {
    return { events: estate.snapshotEvents };
  }
  if (command.tool === 'read-snapshot') {
    const snapshot = estate.snapshots.find((item) => item.id === args.id);
    return snapshot
      ? { secret: snapshot.secret, key_version: snapshot.key_version }
      : { error: 'unknown-snapshot' };
  }
  if (command.tool === 'routes') {
    return { routes: estate.routes };
  }
  if (command.tool === 'principals') {
    return { principals: estate.principals };
  }
  if (command.tool === 'deployments') {
    return { events: estate.deployments };
  }
  if (command.tool === 'auth-leases') {
    return { events: estate.leases };
  }
  if (command.tool === 'authenticate') {
    return authenticate(session, args);
  }
  if (command.tool === 'grants' || command.tool === 'grant-events') {
    if (!session.receipt || args.receipt !== session.receipt) {
      return { error: 'invalid-receipt' };
    }
    if (command.tool === 'grant-events') {
      return { events: estate.grantEvents };
    }
    return {
      context: {
        principal: session.auth.principal,
        deployment: session.auth.deployment,
        resource: RESOURCE,
        audience: AUDIENCE,
        at: GRANT_TIME,
      },
      grants: estate.grants,
    };
  }
  if (command.tool === 'redeem-grant') {
    return redeemGrant(session, args);
  }
  if (command.tool === 'object-versions') {
    if (!session.grant || args.token !== session.readToken) {
      return { error: 'invalid-read-token' };
    }
    return {
      context: { resource: RESOURCE, deployment: session.auth.deployment, at: READ_TIME },
      versions: estate.versions,
      events: estate.versionEvents,
    };
  }
  return protectedRead(session, args);
}

export function inferRoute({ routes, principals, deployments, leases }) {
  const candidates = routes.flatMap((route) => {
    const principal = principals.find((item) => item.service === route.service)?.principal;
    const deploy = latest(
      deployments,
      (event) =>
        event.service === route.service &&
        event.principal === principal &&
        event.mount_ref === route.mount_ref,
      AUTH_TIME,
    );
    const lease = latest(leases, (event) => event.mount_ref === route.mount_ref, AUTH_TIME);
    return deploy?.key_version === 'v1' && lease?.status === 'active'
      ? [{ route: route.id, principal, deployment: deploy.deployment }]
      : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function inferSnapshot({ snapshots, events, credentialRef, mountRef, deployment, at }) {
  const candidates = snapshots.filter(
    (snapshot) =>
      snapshot.credential_ref === credentialRef &&
      snapshot.mount_ref === mountRef &&
      snapshot.deployment_ref === deployment &&
      snapshot.key_version === 'v1' &&
      latest(events, (event) => event.snapshot_id === snapshot.id, at)?.status === 'active',
  );
  return candidates.length === 1 ? candidates[0].id : null;
}

export function inferGrant({ grants, events, context }) {
  const candidates = grants.filter(
    (grant) =>
      grant.principal === context.principal &&
      grant.deployment === context.deployment &&
      grant.resource === context.resource &&
      grant.audience === context.audience &&
      grant.valid_from <= context.at &&
      context.at <= grant.valid_until &&
      latest(events, (event) => event.grant_id === grant.id, context.at)?.status === 'active' &&
      latest(events, (event) => event.grant_id === grant.id, context.at)?.deployment_ref ===
        context.deployment,
  );
  return candidates.length === 1 ? candidates[0].id : null;
}

export function inferReadVersion({ versions, events, context }) {
  const candidates = versions.filter((version) => {
    const publication = latest(events, (event) => event.version_id === version.id, context.at);
    return (
      version.resource === context.resource &&
      publication?.status === 'published' &&
      publication.deployment_ref === context.deployment
    );
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

export function scoreOffense(session) {
  const auth = session.ledger.find((event) => event.type === 'auth.attempt' && event.allowed);
  const receipt = session.ledger.find(
    (event) => event.type === 'auth.receipt' && event.caused_by?.includes(auth?.event_id),
  );
  const grant = session.ledger.find(
    (event) =>
      event.type === 'grant.redeem' &&
      event.allowed &&
      event.caused_by?.includes(receipt?.event_id),
  );
  const read = session.ledger.find(
    (event) =>
      event.type === 'protected.read' &&
      event.allowed &&
      event.caused_by?.includes(grant?.event_id),
  );
  const stages = {
    auth: Boolean(auth && receipt),
    grant: Boolean(grant),
    read: Boolean(read && read.value === session.estate.marker),
  };
  return {
    success: stages.read,
    stages,
    failure: stages.read
      ? null
      : stages.grant
        ? 'protected-read-denied'
        : stages.auth
          ? 'grant-denied'
          : 'authentication-denied',
    decisions: session.ledger
      .filter((event) => ['auth.attempt', 'grant.redeem', 'protected.read'].includes(event.type))
      .map(({ type, allowed, reason }) => ({ type, allowed, reason })),
  };
}

export function referenceOffense(spec) {
  const session = createOffenseSession(spec);
  const snapshots = stepOffense(session, { tool: 'snapshots' }).snapshots;
  const snapshotEvents = stepOffense(session, { tool: 'snapshot-events' }).events;
  const routes = stepOffense(session, { tool: 'routes' }).routes;
  const principals = stepOffense(session, { tool: 'principals' }).principals;
  const deployments = stepOffense(session, { tool: 'deployments' }).events;
  const leases = stepOffense(session, { tool: 'auth-leases' }).events;
  const choice = inferRoute({ routes, principals, deployments, leases });
  const mountRef = routes.find((item) => item.id === choice?.route)?.mount_ref;
  const snapshot = inferSnapshot({
    snapshots,
    events: snapshotEvents,
    credentialRef: session.initial.credential_ref,
    mountRef,
    deployment: choice?.deployment,
    at: AUTH_TIME,
  });
  const secret = snapshot
    ? stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot } }).secret
    : null;
  if (choice && secret) {
    const auth = stepOffense(session, { tool: 'authenticate', args: { ...choice, secret } });
    if (auth.receipt) {
      const catalog = stepOffense(session, { tool: 'grants', args: { receipt: auth.receipt } });
      const events = stepOffense(session, {
        tool: 'grant-events',
        args: { receipt: auth.receipt },
      }).events;
      const grant = inferGrant({ ...catalog, events });
      if (grant) {
        const redeemed = stepOffense(session, {
          tool: 'redeem-grant',
          args: { receipt: auth.receipt, grant },
        });
        if (redeemed.read_token) {
          const objects = stepOffense(session, {
            tool: 'object-versions',
            args: { token: redeemed.read_token },
          });
          const version = inferReadVersion(objects);
          if (version) {
            stepOffense(session, {
              tool: 'protected-read',
              args: { token: redeemed.read_token, version },
            });
          }
        }
      }
    }
  }
  return { session, score: scoreOffense(session) };
}

export function createGrantStageSession(spec) {
  const session = createOffenseSession(spec);
  const snapshots = stepOffense(session, { tool: 'snapshots' }).snapshots;
  const snapshotEvents = stepOffense(session, { tool: 'snapshot-events' }).events;
  const routes = stepOffense(session, { tool: 'routes' }).routes;
  const principals = stepOffense(session, { tool: 'principals' }).principals;
  const deployments = stepOffense(session, { tool: 'deployments' }).events;
  const leases = stepOffense(session, { tool: 'auth-leases' }).events;
  const choice = inferRoute({ routes, principals, deployments, leases });
  const mountRef = routes.find((item) => item.id === choice?.route)?.mount_ref;
  const snapshot = inferSnapshot({
    snapshots,
    events: snapshotEvents,
    credentialRef: session.initial.credential_ref,
    mountRef,
    deployment: choice?.deployment,
    at: AUTH_TIME,
  });
  const secret = snapshot
    ? stepOffense(session, { tool: 'read-snapshot', args: { id: snapshot } }).secret
    : null;
  const auth = stepOffense(session, { tool: 'authenticate', args: { ...choice, secret } });
  if (!auth.receipt) {
    throw new Error('grant-stage fixture requires accepted authentication');
  }
  session.initial = {
    scenario_id: session.initial.scenario_id,
    objective: `Read ${RESOURCE} using the supplied native receipt.`,
    receipt: auth.receipt,
    receipt_expires_at: auth.receipt_expires_at,
    read_policy:
      'A protected read requires the grant token and an object version whose latest publication at read time is published for the authenticated deployment.',
    limits: { grant_redemptions: 1, protected_reads: 1, total_actions: 8 },
    tools: ['grants', 'grant-events', 'redeem-grant', 'object-versions', 'protected-read'],
    tool_schema: {
      grants: TOOL_SCHEMA.grants,
      'grant-events': TOOL_SCHEMA['grant-events'],
      'redeem-grant': TOOL_SCHEMA['redeem-grant'],
      'object-versions': TOOL_SCHEMA['object-versions'],
      'protected-read': TOOL_SCHEMA['protected-read'],
    },
    command_format: { tool: 'tool-name', args: {} },
  };
  session.actionCount = 0;
  return session;
}

export function referenceGrantStage(spec) {
  const session = createGrantStageSession(spec);
  const receipt = session.initial.receipt;
  const catalog = stepOffense(session, { tool: 'grants', args: { receipt } });
  const events = stepOffense(session, { tool: 'grant-events', args: { receipt } }).events;
  const grant = inferGrant({ ...catalog, events });
  if (grant) {
    const redeemed = stepOffense(session, { tool: 'redeem-grant', args: { receipt, grant } });
    if (redeemed.read_token) {
      const objects = stepOffense(session, {
        tool: 'object-versions',
        args: { token: redeemed.read_token },
      });
      const version = inferReadVersion(objects);
      if (version) {
        stepOffense(session, {
          tool: 'protected-read',
          args: { token: redeemed.read_token, version },
        });
      }
    }
  }
  return { session, score: scoreOffense(session) };
}
