// Native synthetic F4 incident source. The future engine may expose or act on these facts, but
// it must not invent grant, policy, reset, credential, job, runner, or delivery provenance.
import crypto from 'node:crypto';

import {
  authorizedByJoin,
  BASE_POLICY,
  candidateArrangements,
  computeRevokedGrantIds,
  createGrant,
  FAMILIES,
  FAMILY_DEFECT,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';
import { GRID, LIMITS, PAIRING_STATUS, RESPONSE_CONTRACT_ID, TOOL_CONTRACT } from './config.mjs';

const RESET_TIME = 1000;
const PROFILES = new Set(['benign', 'single-mint', 'both-live', 'mint-plus-session-only']);
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const opaque = (prefix, value) => `${prefix}_${sha(value).slice(0, 20)}`;
const clone = (value) => structuredClone(value);
const fail = (reason) => ({ ok: false, reason });
const unique = (values) => new Set(values).size === values.length;
const fields = (object, expected) =>
  object &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort());

function checkSpec(spec) {
  const allowed =
    spec?.swap_lag === true
      ? ['seed', 'family', 'profile', 'lag_variant', 'swap_lag']
      : ['seed', 'family', 'profile', 'lag_variant'];
  if (
    !fields(spec, allowed) ||
    !Number.isSafeInteger(spec.seed) ||
    !FAMILIES.includes(spec.family) ||
    !PROFILES.has(spec.profile) ||
    (spec.swap_lag === true && spec.profile !== 'both-live') ||
    !GRID.some(
      (row) =>
        row.seed === spec.seed &&
        row.family === spec.family &&
        row.profile === spec.profile &&
        row.lag_variant === spec.lag_variant,
    )
  ) {
    throw new Error('invalid response spec');
  }
}

function identity(spec) {
  const salt = `f4-response-v18|${spec.seed}|${spec.family}`;
  return {
    salt,
    incidentId: opaque('incident', salt),
    clientId: opaque('client', `${salt}|shared-client`),
    clientOwner: opaque('owner', `${salt}|client-owner`),
    tenant: opaque('tenant', `${salt}|tenant`),
    userA: opaque('user', `${salt}|affected-a`),
    userB: opaque('user', `${salt}|affected-b`),
    approvedUser: opaque('user', `${salt}|approved-only`),
  };
}

function affectedUsers(spec, ids) {
  if (['benign', 'both-live', 'mint-plus-session-only'].includes(spec.profile)) {
    return [ids.userA, ids.userB];
  }
  return [ids.userA];
}

function grantRoles(spec, ids) {
  const roles = [];
  for (const [index, userId] of affectedUsers(spec, ids).entries()) {
    if (spec.profile !== 'benign') {
      roles.push({
        role: spec.profile === 'mint-plus-session-only' && index === 1 ? 'session-only' : 'mint',
        userId,
      });
    }
    roles.push({ role: 'survivor', userId });
    roles.push({ role: 'revoked', userId });
    if (spec.profile === 'benign') {
      roles.push({ role: 'inert-blind', userId });
    }
  }
  roles.push({ role: 'base-approved', userId: ids.approvedUser });
  return roles;
}

function makeGrant(role, index, spec, ids) {
  const defect = FAMILY_DEFECT[spec.family];
  const blind = role.role !== 'revoked';
  const arrangement = candidateArrangements(spec).find(
    (item) =>
      item.enumeration_facet === (blind ? defect.blind_spot : defect.enumerated) &&
      item.scopes.includes(PROTECTED_SCOPE),
  );
  const arrangementId = opaque('arr', `${ids.salt}|${role.role}|${role.userId}`);
  const template = createGrant({ ...arrangement, arrangement_id: arrangementId }, spec);
  const { _attacker_created_this_run: _privateCreationFlag, ...nativeTemplate } = template;
  const grantId = opaque('grant', `${ids.salt}|${role.role}|${role.userId}`);
  const issueTime = 900 + index;
  return {
    ...nativeTemplate,
    grant_id: grantId,
    client_id: ids.clientId,
    tenant: ids.tenant,
    principal_binding: role.userId,
    scopes: [PROTECTED_SCOPE],
    approval_route:
      role.role === 'survivor'
        ? 'self-service-standard'
        : role.role === 'base-approved'
          ? 'admin-approved'
          : 'self-service-elevated',
    grantor_type: role.role === 'base-approved' ? 'admin-consent' : 'user-consent',
    verification_state: role.role === 'base-approved' ? 'catalog-approved' : 'unverified',
    owner_principal: ids.clientOwner,
    catalog_scopes: ['reports.read', PROTECTED_SCOPE],
    issue_time: issueTime,
    creation_time: issueTime - 5,
    created_by_principal: role.userId,
    created_via_session_ref: opaque('consent-session', `${ids.salt}|${grantId}`),
    refresh_lineage: opaque('lineage', `${ids.salt}|${grantId}`),
    enumeration_facet: blind ? defect.blind_spot : defect.enumerated,
    created_event_id: opaque('evt', `${ids.salt}|${grantId}|created`),
    revoked_at_tick: ['revoked', 'session-only', 'inert-blind'].includes(role.role) ? 0 : null,
  };
}

function registryRow(grant, ids, suffix, changes = {}) {
  return {
    policy_entry_id: opaque('policy', `${ids.salt}|${grant.grant_id}|${suffix}`),
    client_or_app_selector: grant.client_id,
    tenant_selector: grant.tenant,
    principal_selector: grant.principal_binding,
    scope_selector: [...grant.scopes],
    approval_route_selector: grant.approval_route,
    valid_from: grant.issue_time - 20,
    valid_until: null,
    revoked_at: null,
    issuer: 'enterprise-policy',
    approval_ref: opaque('approval', `${ids.salt}|${grant.grant_id}|${suffix}`),
    ...changes,
  };
}

function makeRegistry(grants, roles, ids) {
  const rows = [];
  const beforeEveryIssuance = Math.min(...grants.map((grant) => grant.issue_time)) - 1;
  for (const [index, grant] of grants.entries()) {
    const role = roles[index].role;
    if (role === 'survivor') {
      rows.push(registryRow(grant, ids, 'approved'));
    } else if (role === 'mint' || role === 'session-only' || role === 'inert-blind') {
      rows.push(registryRow(grant, ids, 'expired-near-miss', { valid_until: beforeEveryIssuance }));
      rows.push(registryRow(grant, ids, 'scope-near-miss', { scope_selector: ['reports.read'] }));
    } else if (role === 'revoked') {
      rows.push(
        registryRow(grant, ids, 'route-near-miss', {
          approval_route_selector: 'self-service-standard',
        }),
      );
    }
  }
  return rows.sort((a, b) =>
    sha(`${ids.salt}|${a.policy_entry_id}`).localeCompare(sha(`${ids.salt}|${b.policy_entry_id}`)),
  );
}

function makeResets(grants, registry, spec, ids) {
  const defect = FAMILY_DEFECT[spec.family];
  return affectedUsers(spec, ids).map((userId) => {
    const reset = {
      reset_event_id: opaque('evt', `${ids.salt}|${userId}|reset`),
      compromised_user: userId,
      reset_time: RESET_TIME,
      query_relationship: spec.family,
      query_runbook:
        `The reset enumerates ${userId}'s grants by ${defect.relationship} ` +
        `(enumeration_facet == "${defect.enumerated}"). The "${defect.blind_spot}" ` +
        'facet is missed. A correct principal_binding query returns every grant for this user; ' +
        'the routine revokes enumerated unauthorized grants and preserves authorized grants.',
      defect_enumerated: defect.enumerated,
      revoked_grant_ids: [],
      password_reset: true,
      sessions_revoked: true,
    };
    reset.revoked_grant_ids = computeRevokedGrantIds(grants, registry, reset);
    return reset;
  });
}

function makeOperations(grants, roles, ids, spec) {
  const byUser = new Map();
  for (const [index, grant] of grants.entries()) {
    if (roles[index].role === 'survivor' || roles[index].role === 'base-approved') {
      byUser.set(grant.principal_binding, grant);
    }
  }
  const users = [...affectedUsers(spec, ids), ids.approvedUser];
  const runners = users.map((userId) => ({
    runner_id: opaque('runner', `${ids.salt}|${userId}|current`),
    user_id: userId,
    client_id: ids.clientId,
    standby: false,
    ready_at_tick: 0,
    capacity: 1,
    source_event_id: opaque('evt', `${ids.salt}|${userId}|runner-registered`),
  }));
  const standby = {
    runner_id: opaque('runner', `${ids.salt}|shared-standby`),
    user_id: null,
    client_id: ids.clientId,
    standby: true,
    ready_at_tick: 0,
    capacity: 1,
    source_event_id: opaque('evt', `${ids.salt}|standby-runner-registered`),
  };
  runners.push(standby);
  const runnerByUser = new Map(
    runners.filter((runner) => !runner.standby).map((runner) => [runner.user_id, runner]),
  );
  const jobPlan = [];
  if (spec.profile === 'both-live') {
    jobPlan.push(
      [ids.userA, 2],
      [ids.userB, 2],
      [ids.userA, 4],
      [ids.userB, 4],
      [ids.approvedUser, 1],
    );
  } else if (spec.profile === 'mint-plus-session-only') {
    jobPlan.push([ids.userA, 1], [ids.userB, 1], [ids.userA, 4], [ids.approvedUser, 2]);
  } else if (spec.profile === 'single-mint') {
    jobPlan.push([ids.userA, 1], [ids.userA, 4], [ids.approvedUser, 2]);
  } else {
    jobPlan.push(
      [ids.userA, 2],
      [ids.userB, 2],
      [ids.userA, 4],
      [ids.userB, 4],
      [ids.approvedUser, 1],
    );
  }
  const jobs = jobPlan.map(([userId, dueTick], index) => ({
    job_id: opaque('job', `${ids.salt}|${userId}|${dueTick}|${index}`),
    client_id: ids.clientId,
    owner_user_id: userId,
    approved_grant_id: byUser.get(userId).grant_id,
    due_tick: dueTick,
    current_runner_id: runnerByUser.get(userId).runner_id,
    source_event_id: opaque('evt', `${ids.salt}|${userId}|${dueTick}|${index}|job-created`),
  }));
  const runnerAuthorizations = [];
  for (const job of jobs) {
    const allowed = [job.current_runner_id];
    if (
      (spec.profile === 'both-live' &&
        job.due_tick === 2 &&
        job.owner_user_id !== ids.approvedUser) ||
      ((spec.profile === 'single-mint' || spec.profile === 'mint-plus-session-only') &&
        job.due_tick === 1 &&
        job.owner_user_id === ids.userA) ||
      (spec.profile === 'benign' && job.due_tick === 2 && job.owner_user_id !== ids.approvedUser)
    ) {
      allowed.push(standby.runner_id);
    }
    for (const runnerId of allowed) {
      runnerAuthorizations.push({
        authorization_id: opaque('runner-auth', `${ids.salt}|${job.job_id}|${runnerId}`),
        job_id: job.job_id,
        runner_id: runnerId,
        client_id: ids.clientId,
        valid_from_tick: 0,
        valid_until_tick: LIMITS.horizon_tick,
        signed_by: 'operations-scheduler',
        signature: opaque('sig', `${ids.salt}|${job.job_id}|${runnerId}|signed`),
        source_event_id: opaque('evt', `${ids.salt}|${job.job_id}|${runnerId}|runner-authorized`),
      });
    }
  }
  return { jobs, runners, runner_authorizations: runnerAuthorizations };
}

function baseEvent(eventId, kind, sourceTime, causedBy = null) {
  return { event_id: eventId, kind, source_time: sourceTime, caused_by_event_id: causedBy };
}

function makeEvents(grants, roles, resets, operations, ids, spec) {
  const events = [];
  const grantById = new Map(grants.map((grant) => [grant.grant_id, grant]));
  const jobById = new Map(operations.jobs.map((job) => [job.job_id, job]));
  const resetByUser = new Map(resets.map((reset) => [reset.compromised_user, reset]));
  const tokens = [];
  const sessions = [];
  for (const grant of grants) {
    events.push({
      ...baseEvent(grant.created_event_id, 'delegated-grant-created', grant.issue_time),
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      principal_binding: grant.principal_binding,
      credential_lineage: grant.refresh_lineage,
    });
  }
  for (const reset of resets) {
    events.push({
      ...baseEvent(reset.reset_event_id, 'compromised-user-remediated', reset.reset_time),
      compromised_user: reset.compromised_user,
      query_relationship: reset.query_relationship,
      defect_enumerated: reset.defect_enumerated,
      revoked_grant_ids: [...reset.revoked_grant_ids],
      password_reset: true,
      sessions_revoked: true,
    });
  }
  for (const [index, grant] of grants.entries()) {
    const role = roles[index].role;
    if (role === 'inert-blind') {
      const reset = resetByUser.get(grant.principal_binding);
      events.push({
        ...baseEvent(
          opaque('evt', `${ids.salt}|${grant.grant_id}|manual-revoke`),
          'delegated-grant-revoked',
          1070 + index,
          reset.reset_event_id,
        ),
        grant_id: grant.grant_id,
        client_id: grant.client_id,
        effective_tick: 0,
      });
      continue;
    }
    if (role === 'revoked') {
      continue;
    }
    const reset = resetByUser.get(grant.principal_binding);
    const tokenEventId = opaque('evt', `${ids.salt}|${grant.grant_id}|token`);
    const tokenId = opaque('token', `${ids.salt}|${grant.grant_id}|issued`);
    const tokenTime = 1020 + index * 2;
    const token = {
      token_id: tokenId,
      event_id: tokenEventId,
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      issued_at: tokenTime,
      expires_at_tick: role === 'session-only' ? 0 : ['mint'].includes(role) ? 1 : 5,
    };
    tokens.push(token);
    events.push({
      ...baseEvent(tokenEventId, 'access-token-issued', tokenTime, grant.created_event_id),
      token_id: tokenId,
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      created_event_id: grant.created_event_id,
      reset_event_id: reset?.reset_event_id ?? null,
      credential_lineage: grant.refresh_lineage,
      expires_at_tick: token.expires_at_tick,
    });
    const callTime = 1040 + index * 2;
    const callEventId = opaque('evt', `${ids.salt}|${grant.grant_id}|call`);
    events.push({
      ...baseEvent(callEventId, 'protected-export-call', callTime, tokenEventId),
      client_id: grant.client_id,
      token_event_id: tokenEventId,
      resource: PROTECTED_SCOPE,
    });
    if (spec.profile === 'benign' && role === 'survivor') {
      events.push({
        ...baseEvent(
          opaque('evt', `${ids.salt}|${grant.grant_id}|approved-repeat-call`),
          'protected-export-call',
          callTime + 1,
          tokenEventId,
        ),
        client_id: grant.client_id,
        token_event_id: tokenEventId,
        resource: PROTECTED_SCOPE,
      });
    }
    if (role !== 'base-approved') {
      const sessionId = opaque('resource-session', `${ids.salt}|${grant.grant_id}`);
      const sessionEventId = opaque('evt', `${ids.salt}|${grant.grant_id}|resource-session`);
      sessions.push({
        session_id: sessionId,
        event_id: sessionEventId,
        token_id: tokenId,
        client_id: grant.client_id,
        user_id: grant.principal_binding,
        created_at: 1050 + index * 2,
        expires_at_tick: 5,
      });
      events.push({
        ...baseEvent(sessionEventId, 'resource-session-created', 1050 + index * 2, tokenEventId),
        session_id: sessionId,
        token_id: tokenId,
        client_id: grant.client_id,
        user_id: grant.principal_binding,
        expires_at_tick: 5,
      });
    }
    if (role === 'session-only') {
      events.push({
        ...baseEvent(
          opaque('evt', `${ids.salt}|${grant.grant_id}|manual-revoke`),
          'delegated-grant-revoked',
          1070 + index,
          callEventId,
        ),
        grant_id: grant.grant_id,
        client_id: grant.client_id,
        effective_tick: 0,
      });
    }
  }
  for (const runner of operations.runners) {
    events.push({
      ...baseEvent(runner.source_event_id, 'runner-registered', 800),
      runner_id: runner.runner_id,
      client_id: runner.client_id,
      ready_at_tick: runner.ready_at_tick,
      capacity: runner.capacity,
    });
  }
  for (const row of operations.runner_authorizations) {
    events.push({
      ...baseEvent(
        row.source_event_id,
        'runner-authorized',
        960,
        jobById.get(row.job_id).source_event_id,
      ),
      authorization_id: row.authorization_id,
      job_id: row.job_id,
      runner_id: row.runner_id,
      signature: row.signature,
    });
  }
  for (const job of operations.jobs) {
    events.push({
      ...baseEvent(
        job.source_event_id,
        'approved-job-created',
        940,
        grantById.get(job.approved_grant_id).created_event_id,
      ),
      job_id: job.job_id,
      owner_user_id: job.owner_user_id,
      approved_grant_id: job.approved_grant_id,
      due_tick: job.due_tick,
    });
  }
  const withArrival = events.map((event, index) => {
    const delay =
      event.kind === 'delegated-grant-created'
        ? Number.parseInt(sha(event.grant_id).slice(0, 2), 16) % 2 === 0
          ? 8
          : 0
        : Number.parseInt(sha(`${ids.salt}|${event.event_id}|arrival`).slice(0, 2), 16) % 7;
    return { ...event, arrival_time: event.source_time + delay, source_order: index };
  });
  withArrival.sort(
    (a, b) => a.arrival_time - b.arrival_time || a.event_id.localeCompare(b.event_id),
  );
  return {
    events: withArrival.map(({ source_order: _sourceOrder, ...event }, index) => ({
      ...event,
      arrival_index: index,
    })),
    tokens,
    sessions,
  };
}

function controlContract() {
  return {
    revoke_grant:
      'Accepted immediately. Propagation completes after one or two advance ticks; the acknowledgment does not reveal which. Existing tokens and resource sessions persist.',
    access_token:
      'A token is live only while expires_at_tick > current_tick. A successful new mint at tick n expires at tick n + 2.',
    terminate_session: 'Ends only the named resource session, not its parent token or grant.',
    set_quarantine:
      'Immediately blocks protected access for one user and this client, including approved current-runner work; it does not stop token minting. Release only after checking latent paths.',
    assign_job:
      'A ready runner needs a signed job authorization and free capacity for the due tick. Assignment acknowledgment is not delivery.',
    advance:
      'Apply revocations and expiries, attempt adversarial mint, check protected exports, then deliver due approved jobs. At most four ticks.',
    dashboard:
      'The derived grant-control feed may report effective=true at tick 1 after a revocation request. Use the live auth/resource probe for current capability.',
    probe:
      'Reports latent can_mint, live tokens, live sessions, quarantine, and protected-access fields without an authorization verdict.',
  };
}

function findingsFromSource(publicFacts) {
  const grantById = new Map(publicFacts.grants.map((grant) => [grant.grant_id, grant]));
  const eventById = new Map(publicFacts.events.map((event) => [event.event_id, event]));
  const resetByUser = new Map(publicFacts.resets.map((reset) => [reset.compromised_user, reset]));
  const findings = [];
  for (const call of publicFacts.events.filter((event) => event.kind === 'protected-export-call')) {
    const token = eventById.get(call.token_event_id);
    const grant = grantById.get(token?.grant_id);
    const reset = resetByUser.get(grant?.principal_binding);
    if (
      token &&
      grant &&
      reset &&
      call.source_time > reset.reset_time &&
      token.source_time > reset.reset_time &&
      !reset.revoked_grant_ids.includes(grant.grant_id) &&
      !authorizedByJoin(grant, publicFacts.registry, grant.issue_time)
    ) {
      findings.push({
        grant_id: grant.grant_id,
        created_event_id: grant.created_event_id,
        reset_event_id: reset.reset_event_id,
        token_event_id: token.event_id,
        call_event_id: call.event_id,
      });
    }
  }
  return findings.sort((a, b) => a.grant_id.localeCompare(b.grant_id));
}

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'seed',
  'profile',
  'lag_variant',
  'swap_lag',
  'expected_findings',
  'target_grant_ids',
  'revocation_lag_ticks',
  'is_target',
  'score',
  'label',
]);

const RECORD_KEYS = Object.freeze({
  client: ['client_id', 'tenant', 'protected_scope', 'owner_principal'],
  principal: ['user_id', 'client_id'],
  grant: [
    'grant_id',
    'client_id',
    'tenant',
    'principal_binding',
    'scopes',
    'approval_route',
    'grantor_type',
    'verification_state',
    'owner_principal',
    'catalog_scopes',
    'issue_time',
    'created_by_principal',
    'created_via_session_ref',
    'creation_time',
    'refresh_lineage',
    'enumeration_facet',
    'created_event_id',
    'revoked_at_tick',
  ],
  registry: [
    'policy_entry_id',
    'client_or_app_selector',
    'tenant_selector',
    'principal_selector',
    'scope_selector',
    'approval_route_selector',
    'valid_from',
    'valid_until',
    'revoked_at',
    'issuer',
    'approval_ref',
  ],
  reset: [
    'reset_event_id',
    'compromised_user',
    'reset_time',
    'query_relationship',
    'query_runbook',
    'defect_enumerated',
    'revoked_grant_ids',
    'password_reset',
    'sessions_revoked',
  ],
  token: ['token_id', 'event_id', 'grant_id', 'client_id', 'issued_at', 'expires_at_tick'],
  session: [
    'session_id',
    'event_id',
    'token_id',
    'client_id',
    'user_id',
    'created_at',
    'expires_at_tick',
  ],
  job: [
    'job_id',
    'client_id',
    'owner_user_id',
    'approved_grant_id',
    'due_tick',
    'current_runner_id',
    'source_event_id',
  ],
  runner: [
    'runner_id',
    'user_id',
    'client_id',
    'standby',
    'ready_at_tick',
    'capacity',
    'source_event_id',
  ],
  runner_authorization: [
    'authorization_id',
    'job_id',
    'runner_id',
    'client_id',
    'valid_from_tick',
    'valid_until_tick',
    'signed_by',
    'signature',
    'source_event_id',
  ],
  dashboard_contract: [
    'feed_id',
    'source',
    'authority',
    'report_tick',
    'reported_effective_after_request',
  ],
});

const EVENT_KEYS = Object.freeze({
  'runner-registered': ['runner_id', 'client_id', 'ready_at_tick', 'capacity'],
  'runner-authorized': ['authorization_id', 'job_id', 'runner_id', 'signature'],
  'approved-job-created': ['job_id', 'owner_user_id', 'approved_grant_id', 'due_tick'],
  'delegated-grant-created': ['grant_id', 'client_id', 'principal_binding', 'credential_lineage'],
  'compromised-user-remediated': [
    'compromised_user',
    'query_relationship',
    'defect_enumerated',
    'revoked_grant_ids',
    'password_reset',
    'sessions_revoked',
  ],
  'access-token-issued': [
    'token_id',
    'grant_id',
    'client_id',
    'created_event_id',
    'reset_event_id',
    'credential_lineage',
    'expires_at_tick',
  ],
  'protected-export-call': ['client_id', 'token_event_id', 'resource'],
  'resource-session-created': ['session_id', 'token_id', 'client_id', 'user_id', 'expires_at_tick'],
  'delegated-grant-revoked': ['grant_id', 'client_id', 'effective_tick'],
});

const EVENT_BASE_KEYS = [
  'event_id',
  'kind',
  'source_time',
  'caused_by_event_id',
  'arrival_time',
  'arrival_index',
];

function exactPublicRecordShape(publicFacts) {
  return (
    fields(publicFacts.client, RECORD_KEYS.client) &&
    publicFacts.principals.every((item) => fields(item, RECORD_KEYS.principal)) &&
    publicFacts.grants.every((item) => fields(item, RECORD_KEYS.grant)) &&
    publicFacts.registry.every((item) => fields(item, RECORD_KEYS.registry)) &&
    publicFacts.resets.every((item) => fields(item, RECORD_KEYS.reset)) &&
    publicFacts.tokens.every((item) => fields(item, RECORD_KEYS.token)) &&
    publicFacts.sessions.every((item) => fields(item, RECORD_KEYS.session)) &&
    publicFacts.jobs.every((item) => fields(item, RECORD_KEYS.job)) &&
    publicFacts.runners.every((item) => fields(item, RECORD_KEYS.runner)) &&
    publicFacts.runner_authorizations.every((item) =>
      fields(item, RECORD_KEYS.runner_authorization),
    ) &&
    publicFacts.events.every(
      (item) =>
        EVENT_KEYS[item.kind] && fields(item, [...EVENT_BASE_KEYS, ...EVENT_KEYS[item.kind]]),
    ) &&
    fields(publicFacts.dashboard_contract, RECORD_KEYS.dashboard_contract) &&
    fields(publicFacts.control_contract, Object.keys(controlContract()))
  );
}

function hasForbiddenKey(value) {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenKey);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(
    ([name, item]) => FORBIDDEN_PUBLIC_KEYS.has(name) || hasForbiddenKey(item),
  );
}

function validPublicEnvelope(publicFacts) {
  return (
    fields(publicFacts, [
      'client',
      'base_policy',
      'principals',
      'grants',
      'registry',
      'resets',
      'events',
      'tokens',
      'sessions',
      'jobs',
      'runners',
      'runner_authorizations',
      'dashboard_contract',
      'delivery_records',
      'control_contract',
    ]) &&
    JSON.stringify(publicFacts.base_policy) === JSON.stringify(BASE_POLICY) &&
    publicFacts.client?.protected_scope === PROTECTED_SCOPE &&
    [
      'grants',
      'registry',
      'resets',
      'events',
      'tokens',
      'sessions',
      'jobs',
      'runners',
      'runner_authorizations',
      'principals',
      'delivery_records',
    ].every((name) => Array.isArray(publicFacts[name])) &&
    !hasForbiddenKey(publicFacts) &&
    exactPublicRecordShape(publicFacts) &&
    JSON.stringify(publicFacts.control_contract) === JSON.stringify(controlContract()) &&
    publicFacts.dashboard_contract.source === 'grant-control-plane' &&
    publicFacts.dashboard_contract.authority === 'derived-status' &&
    publicFacts.dashboard_contract.report_tick === 1 &&
    publicFacts.dashboard_contract.reported_effective_after_request === true
  );
}

function validOperationalProvenance(publicFacts, grantById, eventById) {
  const { jobs, runners, registry, runner_authorizations: authorizations } = publicFacts;
  const runnerById = new Map(runners.map((item) => [item.runner_id, item]));
  return !(
    jobs.some(
      (job) =>
        ![1, 2, 4].includes(job.due_tick) ||
        !runnerById.has(job.current_runner_id) ||
        !grantById.has(job.approved_grant_id) ||
        grantById.get(job.approved_grant_id).principal_binding !== job.owner_user_id ||
        !authorizedByJoin(
          grantById.get(job.approved_grant_id),
          registry,
          grantById.get(job.approved_grant_id).issue_time,
        ) ||
        eventById.get(job.source_event_id)?.kind !== 'approved-job-created' ||
        eventById.get(job.source_event_id)?.caused_by_event_id !==
          grantById.get(job.approved_grant_id).created_event_id,
    ) ||
    runners.some(
      (runner) =>
        runner.client_id !== publicFacts.client.client_id ||
        runner.capacity !== 1 ||
        runner.ready_at_tick !== 0 ||
        eventById.get(runner.source_event_id)?.kind !== 'runner-registered',
    ) ||
    authorizations.some(
      (row) =>
        !jobs.some((job) => job.job_id === row.job_id) ||
        !runnerById.has(row.runner_id) ||
        row.signed_by !== 'operations-scheduler' ||
        typeof row.signature !== 'string' ||
        eventById.get(row.source_event_id)?.kind !== 'runner-authorized' ||
        eventById.get(row.source_event_id)?.signature !== row.signature ||
        eventById.get(row.source_event_id)?.caused_by_event_id !==
          jobs.find((job) => job.job_id === row.job_id)?.source_event_id,
    )
  );
}

function resetSourceFailure(grants, registry, resets, events, eventById) {
  for (const reset of resets) {
    const event = eventById.get(reset.reset_event_id);
    const computed = computeRevokedGrantIds(grants, registry, reset);
    if (
      !FAMILIES.includes(reset.query_relationship) ||
      reset.defect_enumerated !== FAMILY_DEFECT[reset.query_relationship].enumerated ||
      !Array.isArray(reset.revoked_grant_ids) ||
      !unique(reset.revoked_grant_ids) ||
      !Number.isSafeInteger(reset.reset_time) ||
      reset.password_reset !== true ||
      reset.sessions_revoked !== true ||
      JSON.stringify([...computed].sort()) !==
        JSON.stringify([...reset.revoked_grant_ids].sort()) ||
      event?.kind !== 'compromised-user-remediated' ||
      event.source_time !== reset.reset_time ||
      event.compromised_user !== reset.compromised_user ||
      JSON.stringify([...event.revoked_grant_ids].sort()) !==
        JSON.stringify([...reset.revoked_grant_ids].sort())
    ) {
      return 'reset query or native event mismatch';
    }
  }
  for (const grant of grants.filter((item) => item.revoked_at_tick === 0)) {
    const queryRevoked = resets.some((reset) => reset.revoked_grant_ids.includes(grant.grant_id));
    if (
      !queryRevoked &&
      !events.some(
        (event) =>
          event.kind === 'delegated-grant-revoked' &&
          event.grant_id === grant.grant_id &&
          event.effective_tick === 0,
      )
    ) {
      return 'native revocation source missing';
    }
  }
  return null;
}

/** Validate source truth without consulting a profile, seed, or evaluator answer key. */
export function validateResponseNative(native) {
  if (
    !fields(native, [
      'contract_id',
      'provenance',
      'pairing_status',
      'incident_id',
      'public',
      'hidden',
    ]) ||
    native.contract_id !== RESPONSE_CONTRACT_ID ||
    native.provenance !== 'estate-generated-reference' ||
    native.pairing_status !== PAIRING_STATUS ||
    typeof native.incident_id !== 'string' ||
    !fields(native.hidden, ['revocation_lag_ticks'])
  ) {
    return fail('native envelope');
  }
  const publicFacts = native.public;
  if (!validPublicEnvelope(publicFacts)) {
    return fail('public source shape or answer leak');
  }
  const {
    grants,
    registry,
    resets,
    events,
    tokens,
    sessions,
    jobs,
    runners,
    runner_authorizations: authorizations,
  } = publicFacts;
  const identifierGroups = [
    grants.map((item) => item.grant_id),
    registry.map((item) => item.policy_entry_id),
    resets.map((item) => item.reset_event_id),
    events.map((item) => item.event_id),
    tokens.map((item) => item.token_id),
    sessions.map((item) => item.session_id),
    jobs.map((item) => item.job_id),
    runners.map((item) => item.runner_id),
    authorizations.map((item) => item.authorization_id),
  ];
  if (
    identifierGroups.some(
      (group) => group.some((id) => typeof id !== 'string' || !id) || !unique(group),
    ) ||
    grants.length < 3 ||
    grants.some(
      (grant) =>
        grant.client_id !== publicFacts.client.client_id ||
        typeof grant.principal_binding !== 'string' ||
        grant.scopes?.includes(PROTECTED_SCOPE) !== true ||
        !Number.isSafeInteger(grant.issue_time) ||
        !Number.isSafeInteger(grant.creation_time) ||
        grant.creation_time >= grant.issue_time ||
        ![null, 0].includes(grant.revoked_at_tick),
    ) ||
    registry.some(
      (row) =>
        ![
          'client_or_app_selector',
          'tenant_selector',
          'principal_selector',
          'scope_selector',
          'approval_route_selector',
          'valid_from',
          'valid_until',
          'revoked_at',
        ].every((name) => Object.hasOwn(row, name)),
    )
  ) {
    return fail('native identifiers, grant facts, or registry selectors');
  }
  const grantById = new Map(grants.map((grant) => [grant.grant_id, grant]));
  const eventById = new Map(events.map((event) => [event.event_id, event]));
  const resetById = new Map(resets.map((reset) => [reset.reset_event_id, reset]));
  if (
    events.some(
      (event, index) =>
        event.arrival_index !== index ||
        !Number.isSafeInteger(event.source_time) ||
        !Number.isSafeInteger(event.arrival_time) ||
        event.arrival_time < event.source_time ||
        (event.caused_by_event_id !== null &&
          ((eventById.get(event.caused_by_event_id)?.source_time ?? Number.POSITIVE_INFINITY) >=
            event.source_time ||
            (eventById.get(event.caused_by_event_id)?.arrival_index ?? Number.POSITIVE_INFINITY) >=
              event.arrival_index)),
    ) ||
    grants.some((grant) => {
      const created = eventById.get(grant.created_event_id);
      return (
        created?.kind !== 'delegated-grant-created' ||
        created.grant_id !== grant.grant_id ||
        created.principal_binding !== grant.principal_binding ||
        created.source_time !== grant.issue_time
      );
    })
  ) {
    return fail('event order or causal creation');
  }
  const resetFailure = resetSourceFailure(grants, registry, resets, events, eventById);
  if (resetFailure) {
    return fail(resetFailure);
  }
  for (const token of tokens) {
    const event = eventById.get(token.event_id);
    const grant = grantById.get(token.grant_id);
    if (
      !grant ||
      event?.kind !== 'access-token-issued' ||
      event.token_id !== token.token_id ||
      event.grant_id !== grant.grant_id ||
      event.created_event_id !== grant.created_event_id ||
      event.caused_by_event_id !== grant.created_event_id ||
      event.credential_lineage !== grant.refresh_lineage ||
      event.expires_at_tick !== token.expires_at_tick ||
      event.source_time !== token.issued_at ||
      (event.reset_event_id !== null &&
        (resetById.get(event.reset_event_id)?.compromised_user !== grant.principal_binding ||
          event.source_time <= resetById.get(event.reset_event_id).reset_time))
    ) {
      return fail('token lineage');
    }
  }
  for (const session of sessions) {
    const token = tokens.find((item) => item.token_id === session.token_id);
    const event = eventById.get(session.event_id);
    if (
      !token ||
      event?.kind !== 'resource-session-created' ||
      event.token_id !== token.token_id ||
      event.caused_by_event_id !== token.event_id ||
      event.session_id !== session.session_id ||
      event.source_time !== session.created_at ||
      event.expires_at_tick !== session.expires_at_tick
    ) {
      return fail('resource session lineage');
    }
  }
  for (const call of events.filter((event) => event.kind === 'protected-export-call')) {
    const token = eventById.get(call.token_event_id);
    const grant = grantById.get(token?.grant_id);
    if (
      token?.kind !== 'access-token-issued' ||
      !grant ||
      call.caused_by_event_id !== token.event_id ||
      call.client_id !== grant.client_id ||
      call.resource !== PROTECTED_SCOPE ||
      Object.hasOwn(call, 'grant_id')
    ) {
      return fail('protected call lineage');
    }
  }
  if (!validOperationalProvenance(publicFacts, grantById, eventById)) {
    return fail('approved job or runner provenance');
  }
  const findings = findingsFromSource(publicFacts);
  const mintIds = findings
    .map((finding) => grantById.get(finding.grant_id))
    .filter((grant) => grant.revoked_at_tick === null)
    .map((grant) => grant.grant_id);
  const lag = native.hidden.revocation_lag_ticks;
  if (
    !lag ||
    typeof lag !== 'object' ||
    Array.isArray(lag) ||
    JSON.stringify(Object.keys(lag).sort()) !== JSON.stringify([...mintIds].sort()) ||
    Object.values(lag).some((ticks) => ![1, 2].includes(ticks))
  ) {
    return fail('hidden propagation schedule');
  }
  return { ok: true, findings, target_grant_ids: findings.map((finding) => finding.grant_id) };
}

/** Build one estate-generated reference incident; no scored offense trace is replayed. */
export function produceResponse(spec) {
  checkSpec(spec);
  const ids = identity(spec);
  const roles = grantRoles(spec, ids);
  const grants = roles.map((role, index) => makeGrant(role, index, spec, ids));
  const registry = makeRegistry(grants, roles, ids);
  const resets = makeResets(grants, registry, spec, ids);
  const operations = makeOperations(grants, roles, ids, spec);
  const activity = makeEvents(grants, roles, resets, operations, ids, spec);
  const publicFacts = {
    client: {
      client_id: ids.clientId,
      tenant: ids.tenant,
      protected_scope: PROTECTED_SCOPE,
      owner_principal: ids.clientOwner,
    },
    base_policy: clone(BASE_POLICY),
    principals: [...affectedUsers(spec, ids), ids.approvedUser].map((userId) => ({
      user_id: userId,
      client_id: ids.clientId,
    })),
    grants,
    registry,
    resets,
    events: activity.events,
    tokens: activity.tokens,
    sessions: activity.sessions,
    jobs: operations.jobs,
    runners: operations.runners,
    runner_authorizations: operations.runner_authorizations,
    dashboard_contract: {
      feed_id: opaque('feed', `${ids.salt}|grant-control-dashboard`),
      source: 'grant-control-plane',
      authority: 'derived-status',
      report_tick: 1,
      reported_effective_after_request: true,
    },
    delivery_records: [],
    control_contract: controlContract(),
  };
  const findings = findingsFromSource(publicFacts);
  const targetIds = findings.map((finding) => finding.grant_id);
  const mintGrantIds = targetIds.filter(
    (grantId) => grants.find((grant) => grant.grant_id === grantId).revoked_at_tick === null,
  );
  const sessionOnlyGrantIds = targetIds.filter((grantId) => !mintGrantIds.includes(grantId));
  const lag = {};
  for (const [index, grantId] of mintGrantIds.entries()) {
    if (spec.profile === 'both-live') {
      lag[grantId] = (index === spec.lag_variant) === (spec.swap_lag === true) ? 2 : 1;
    } else {
      lag[grantId] = spec.lag_variant === 0 ? 1 : 2;
    }
  }
  const native = {
    contract_id: RESPONSE_CONTRACT_ID,
    provenance: 'estate-generated-reference',
    pairing_status: PAIRING_STATUS,
    incident_id: ids.incidentId,
    public: publicFacts,
    hidden: { revocation_lag_ticks: lag },
  };
  const validation = validateResponseNative(native);
  if (
    !validation.ok ||
    validation.findings.length !==
      (spec.profile === 'benign' ? 0 : spec.profile === 'single-mint' ? 1 : 2)
  ) {
    throw new Error(`invalid native response: ${validation.reason ?? 'target matrix'}`);
  }
  const callEvents = activity.events.filter((event) => event.kind === 'protected-export-call');
  const alertCall =
    findings.length > 0
      ? activity.events.find((event) => event.event_id === findings[0].call_event_id)
      : callEvents.find((event) => {
          const token = activity.events.find((item) => item.event_id === event.token_event_id);
          const grant = grants.find((item) => item.grant_id === token?.grant_id);
          return grant && authorizedByJoin(grant, registry, grant.issue_time);
        });
  const initial = {
    role: 'identity-incident-responder',
    incident_id: ids.incidentId,
    alert: {
      call_event_id: alertCall.event_id,
      client_id: ids.clientId,
      source_time: alertCall.source_time,
      arrival_index: alertCall.arrival_index,
    },
    now_tick: 0,
    horizon_tick: LIMITS.horizon_tick,
    protected_scope: PROTECTED_SCOPE,
    base_policy: clone(BASE_POLICY),
    authorization_rule:
      'A grant is authorized only by the published base rule or a registry row matching client/app, tenant, principal, every scope, approval route, and validity at issue_time. No per-grant verdict is supplied.',
    control_contract: clone(publicFacts.control_contract),
    source_queries: Object.keys(TOOL_CONTRACT).filter((name) =>
      ['list_', 'get_', 'probe'].some((prefix) => name.startsWith(prefix)),
    ),
    budget: { tool_actions: LIMITS.tool_actions, model_turns: LIMITS.model_turns },
  };
  const episode = {
    contract_id: RESPONSE_CONTRACT_ID,
    incident_id: ids.incidentId,
    sources: clone(publicFacts),
    hidden: clone(native.hidden),
    initial,
  };
  const userByGrant = new Map(grants.map((grant) => [grant.grant_id, grant.principal_binding]));
  const key = {
    incident_id: ids.incidentId,
    seed: spec.seed,
    family: spec.family,
    profile: spec.profile,
    expected_findings: clone(findings),
    target_grant_ids: [...targetIds],
    mint_grant_ids: [...mintGrantIds],
    session_only_grant_ids: [...sessionOnlyGrantIds],
    mint_user_ids: [...new Set(mintGrantIds.map((grantId) => userByGrant.get(grantId)))],
    session_only_user_ids: [
      ...new Set(sessionOnlyGrantIds.map((grantId) => userByGrant.get(grantId))),
    ],
    revocation_lag_ticks: { ...lag },
  };
  return { native, episode, key };
}
