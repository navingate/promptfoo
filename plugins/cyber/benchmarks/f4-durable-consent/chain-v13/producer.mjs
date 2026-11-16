// New synthetic F4 incident producer: one shared reset and several concurrent grant lineages.
// It uses the shared estate's authorization and revocation semantics, not old offense captures.
import crypto from 'node:crypto';

import {
  authorizedByJoin,
  BASE_POLICY,
  computeRevokedGrantIds,
  entryCovers,
  entryValidAt,
  FAMILIES,
  FAMILY_DEFECT,
  labelFor,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

export const INCIDENT_CONTRACT = 'f4-consent-incident-native-v1';

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const number = (key, modulus) => Number.parseInt(sha(key).slice(0, 8), 16) % modulus;
const opaque = (kind, key) => kind + '_' + sha(key).slice(0, 20);
const ordered = (items, salt, key) =>
  [...items].sort((a, b) => sha(salt + '|' + key(a)).localeCompare(sha(salt + '|' + key(b))));
const alternateRoute = {
  'self-service-standard': 'self-service-elevated',
  'self-service-elevated': 'self-service-standard',
  'admin-approved': 'self-service-standard',
};
const nearModes = ['scope', 'route', 'tenant', 'principal', 'expired', 'not-yet-valid', 'revoked'];

function checkSpec({ seed, family, targetCount, size }) {
  if (
    !Number.isSafeInteger(seed) ||
    !FAMILIES.includes(family) ||
    !Number.isInteger(targetCount) ||
    targetCount < 0 ||
    targetCount > 2 ||
    !Number.isInteger(size) ||
    size < Math.max(6, 5 + targetCount) ||
    size > 8
  ) {
    throw new Error('invalid native incident spec');
  }
}

function rolePlan(targetCount, size, salt) {
  const roles = [
    { kind: 'survivor', pair: 'primary', ordinal: 0 },
    { kind: 'survivor', pair: 'secondary', ordinal: 1 },
    { kind: 'abandoned', pair: 'secondary', ordinal: 0 },
    { kind: 'revoked', ordinal: 0 },
    { kind: 'base', ordinal: 0 },
  ];
  if (targetCount === 0) {
    roles.push({ kind: 'abandoned', pair: 'primary', ordinal: 1 });
  } else {
    for (let index = 0; index < targetCount; index += 1) {
      roles.push({ kind: 'target', ...(index === 0 ? { pair: 'primary' } : {}), ordinal: index });
    }
  }
  const extras = ['survivor', 'abandoned', 'revoked', 'base'];
  while (roles.length < size) {
    const ordinal = roles.length;
    roles.push({ kind: extras[number(salt + '|extra|' + ordinal, extras.length)], ordinal });
  }
  return ordered(
    roles,
    salt + '|grant-order',
    (role) => role.kind + '|' + role.ordinal + '|' + (role.pair ?? 'none'),
  );
}

function makeGrant(role, index, context) {
  const { salt, resetTime, compromisedUser, defect } = context;
  const key = salt + '|slot|' + index;
  const paired = Boolean(role.pair);
  const pairKey = salt + '|pair|' + role.pair;
  const approvedRoute =
    number(pairKey + '|route', 2) === 0 ? 'self-service-elevated' : 'self-service-standard';
  const route =
    role.kind === 'base'
      ? 'admin-approved'
      : paired
        ? role.kind === 'survivor'
          ? approvedRoute
          : alternateRoute[approvedRoute]
        : number(key + '|route', 2) === 0
          ? 'self-service-elevated'
          : 'self-service-standard';
  const tenant =
    (paired ? number(pairKey + '|tenant', 2) : number(key + '|tenant', 2)) === 0
      ? 'internal'
      : 'external';
  const scopes =
    (paired ? number(pairKey + '|scopes', 2) : number(key + '|scopes', 2)) === 0
      ? [PROTECTED_SCOPE]
      : ['reports.read', PROTECTED_SCOPE];
  const nonBaseGrantor = ['user-consent', 'partner-consent', 'admin-consent'][
    number(paired ? pairKey + '|grantor' : key + '|grantor', 3)
  ];
  const nonBaseVerification = ['unverified', 'verified', 'catalog-approved'][
    number(paired ? pairKey + '|verification' : key + '|verification', 3)
  ];
  const issueTime = resetTime - 100 - number(key + '|issue-offset', 650);
  return {
    grant_id: opaque('grant', key + '|grant'),
    client_id: opaque('client', paired ? pairKey + '|shared-client' : key + '|client'),
    tenant,
    principal_binding: compromisedUser,
    scopes,
    approval_route: route,
    grantor_type: role.kind === 'base' ? 'admin-consent' : nonBaseGrantor,
    verification_state: role.kind === 'base' ? 'catalog-approved' : nonBaseVerification,
    owner_principal: opaque('owner', paired ? pairKey + '|shared-owner' : key + '|owner'),
    catalog_scopes: ['reports.read', PROTECTED_SCOPE],
    issue_time: issueTime,
    creation_time: issueTime - 1 - number(key + '|creation-offset', 20),
    created_by_principal: compromisedUser,
    created_via_session_ref: opaque('session', key + '|session'),
    refresh_lineage: opaque('lineage', key + '|lineage'),
    enumeration_facet:
      role.kind === 'revoked'
        ? defect.enumerated
        : role.kind === 'base' && number(key + '|base-facet', 2) === 0
          ? defect.enumerated
          : defect.blind_spot,
  };
}

function rowFor(grant, index, context, nearMode = null) {
  const { salt, resetTime } = context;
  const key = salt + '|policy|' + grant.grant_id + '|' + index;
  const paired = context.pairedClients.has(grant.client_id);
  const row = {
    policy_entry_id: opaque('policy', key),
    client_or_app_selector:
      number(key + '|client-array', 2) === 0
        ? [grant.client_id, opaque('client', key + '|other-client')]
        : grant.client_id,
    tenant_selector: number(key + '|tenant-wildcard', 4) === 0 ? '*' : grant.tenant,
    principal_selector:
      number(key + '|principal-wildcard', 4) === 0 ? '*' : grant.principal_binding,
    scope_selector:
      number(key + '|scope-wildcard', 4) === 0 ? '*' : [...grant.scopes, 'reports.audit'],
    // Shared-client rows retain the route difference between those two grants.
    approval_route_selector:
      !paired && number(key + '|route-wildcard', 5) === 0 ? '*' : grant.approval_route,
    valid_from: grant.issue_time - 1 - number(key + '|valid-from', 100),
    valid_until:
      number(key + '|valid-until', 2) === 0
        ? null
        : resetTime + 100 + number(key + '|valid-until-offset', 200),
    revoked_at:
      number(key + '|future-revoke', 4) === 0
        ? resetTime + 100 + number(key + '|future-revoke-offset', 200)
        : null,
    issuer: 'enterprise-policy',
    approval_ref: opaque('approval', key + '|approval'),
  };
  if (nearMode === 'scope') {
    row.scope_selector = ['reports.read'];
  } else if (nearMode === 'route') {
    row.approval_route_selector = alternateRoute[grant.approval_route];
  } else if (nearMode === 'tenant') {
    row.tenant_selector = grant.tenant === 'internal' ? 'external' : 'internal';
  } else if (nearMode === 'principal') {
    row.principal_selector = opaque('user', key + '|other-principal');
  } else if (nearMode === 'expired') {
    row.valid_until = grant.issue_time - 1;
  } else if (nearMode === 'not-yet-valid') {
    row.valid_from = grant.issue_time + 1;
  } else if (nearMode === 'revoked') {
    row.revoked_at = grant.issue_time - 1;
  }
  const covers = entryCovers(row, grant) && entryValidAt(row, grant.issue_time);
  if (covers === Boolean(nearMode)) {
    throw new Error('native registry row construction failed');
  }
  return row;
}

function makeRegistry(grants, roles, context) {
  const rows = [];
  for (const [index, grant] of grants.entries()) {
    const role = roles[index];
    const modeIndex = number(context.salt + '|near-mode|' + index, nearModes.length);
    rows.push(rowFor(grant, 0, context, role.kind === 'survivor' ? null : nearModes[modeIndex]));
    const secondMode = nearModes[(modeIndex + 1) % nearModes.length];
    // A route near-miss for the approved side would approve its same-client counterpart.
    rows.push(
      rowFor(
        grant,
        1,
        context,
        role.pair && role.kind === 'survivor' && secondMode === 'route' ? 'scope' : secondMode,
      ),
    );
  }
  return ordered(rows, context.salt + '|registry-order', (row) => row.policy_entry_id);
}

function makeEvents(grants, roles, remediation, context) {
  const { salt, resetTime } = context;
  const events = [
    {
      event_id: remediation.reset_event_id,
      kind: 'compromised-user-remediated',
      time: resetTime,
      caused_by_event_id: null,
      compromised_user: remediation.compromised_user,
      revoked_grant_ids: [...remediation.revoked_grant_ids],
      query_relationship: remediation.query_relationship,
      password_reset: remediation.password_reset,
      sessions_revoked: remediation.sessions_revoked,
    },
  ];
  for (const [index, grant] of grants.entries()) {
    const role = roles[index];
    const created = {
      event_id: opaque('evt', salt + '|' + index + '|created'),
      kind: 'delegated-grant-created',
      time: grant.issue_time,
      caused_by_event_id: null,
      grant_id: grant.grant_id,
      credential_lineage: grant.refresh_lineage,
      client_id: grant.client_id,
      principal_binding: grant.principal_binding,
    };
    const continuing = ['target', 'survivor', 'base'].includes(role.kind);
    const revoked = remediation.revoked_grant_ids.includes(grant.grant_id);
    if (continuing && revoked) {
      throw new Error('continuing grant was revoked');
    }
    events.push(created);
    const tokenCount = role.kind === 'survivor' && role.pair ? 2 : 1;
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      const key = salt + '|' + index + '|' + tokenIndex;
      const preReset =
        role.kind === 'revoked' ||
        (role.kind === 'abandoned' &&
          !role.pair &&
          number(salt + '|' + index + '|abandon-time', 2) === 0);
      const tokenTime = preReset
        ? resetTime - 60 + number(key + '|pre-token', 10)
        : resetTime + 10 + tokenIndex * 20 + number(key + '|post-token', 15);
      const token = {
        event_id: opaque('evt', key + '|token'),
        kind: 'access-token-issued',
        time: tokenTime,
        caused_by_event_id: created.event_id,
        grant_id: grant.grant_id,
        client_id: grant.client_id,
        credential_lineage: grant.refresh_lineage,
      };
      events.push(token);
      const survivorCalls =
        role.kind === 'survivor' &&
        (!role.pair ||
          role.pair === 'secondary' ||
          context.targetCount === 0 ||
          tokenIndex === number(salt + '|primary-survivor-call', 2));
      const callMade =
        role.kind === 'target' ||
        role.kind === 'base' ||
        survivorCalls ||
        (role.kind === 'revoked' && number(key + '|pre-call', 2) === 0);
      if (callMade) {
        events.push({
          event_id: opaque('evt', key + '|call'),
          kind: 'protected-export-call',
          time: tokenTime + 5 + number(key + '|call-delay', 15),
          caused_by_event_id: token.event_id,
          client_id: grant.client_id,
          resource: PROTECTED_SCOPE,
        });
      }
    }
  }
  return events
    .sort((a, b) => {
      const arrivalA = a.time + number(salt + '|arrival|' + a.event_id, 14);
      const arrivalB = b.time + number(salt + '|arrival|' + b.event_id, 14);
      return arrivalA - arrivalB || a.event_id.localeCompare(b.event_id);
    })
    .map((event, arrivalIndex) => ({ ...event, arrival_index: arrivalIndex }));
}

/** Produce a deterministic synthetic native incident with one shared reset. */
export function produceIncident({ seed, family, targetCount, size = 6 }) {
  checkSpec({ seed, family, targetCount, size });
  const salt = 'f4-v13-native|' + seed + '|' + family + '|' + targetCount + '|' + size;
  const resetTime = 10000 + number(salt + '|reset-time', 9000);
  const compromisedUser = opaque('user', salt + '|compromised-user');
  const defect = FAMILY_DEFECT[family];
  const roles = rolePlan(targetCount, size, salt);
  const pairedClients = new Set(
    roles
      .filter((role) => role.pair)
      .map((role) => opaque('client', salt + '|pair|' + role.pair + '|shared-client')),
  );
  const context = { salt, resetTime, compromisedUser, defect, pairedClients, targetCount };
  const grants = roles.map((role, index) => makeGrant(role, index, context));
  const registry = makeRegistry(grants, roles, context);
  const remediation = {
    reset_event_id: opaque('evt', salt + '|reset'),
    compromised_user: compromisedUser,
    reset_time: resetTime,
    query_relationship: family,
    query_runbook:
      'The reset query enumerates the compromised user grants by the ' +
      defect.relationship +
      ' relationship (enumeration_facet == "' +
      defect.enumerated +
      '"). Grants with enumeration_facet == "' +
      defect.blind_spot +
      '" are missed. A correct principal query would return every grant bound to the user. Authorized grants are preserved.',
    defect_enumerated: defect.enumerated,
    revoked_grant_ids: [],
    password_reset: true,
    sessions_revoked: true,
  };
  remediation.revoked_grant_ids = computeRevokedGrantIds(grants, registry, remediation);
  const events = makeEvents(grants, roles, remediation, context);
  const incident = {
    contract: INCIDENT_CONTRACT,
    incident_id: opaque('incident', salt),
    protected_scope: PROTECTED_SCOPE,
    base_policy: structuredClone(BASE_POLICY),
    grants,
    registry,
    remediation,
    events,
  };
  const validation = validateIncident(incident);
  if (!validation.ok) {
    throw new Error('invalid native incident: ' + validation.reason);
  }
  if (validation.target_grant_ids.length !== targetCount) {
    throw new Error('native incident target count mismatch');
  }
  return incident;
}

const fail = (reason) => ({ ok: false, reason });
const unique = (values) => new Set(values).size === values.length;
const validTime = (value) => Number.isSafeInteger(value) && value >= 0;
const validIncidentShape = (incident) =>
  incident?.contract === INCIDENT_CONTRACT &&
  Boolean(incident.incident_id) &&
  incident.protected_scope === PROTECTED_SCOPE &&
  JSON.stringify(incident.base_policy) === JSON.stringify(BASE_POLICY) &&
  Array.isArray(incident.grants) &&
  incident.grants.length >= 4 &&
  incident.grants.length <= 8 &&
  Array.isArray(incident.registry) &&
  incident.registry.length === incident.grants.length * 2 &&
  Array.isArray(incident.events);
const validGrantFacts = (grant, compromisedUser) =>
  Boolean(grant.grant_id) &&
  Boolean(grant.client_id) &&
  Boolean(grant.refresh_lineage) &&
  validTime(grant.issue_time) &&
  Array.isArray(grant.scopes) &&
  grant.scopes.includes(PROTECTED_SCOPE) &&
  Array.isArray(grant.catalog_scopes) &&
  grant.principal_binding === compromisedUser &&
  !Object.hasOwn(grant, 'accessed_post_reset') &&
  !Object.hasOwn(grant, 'call_time') &&
  Object.keys(grant).every((key) => !key.startsWith('_'));
const sharedClientFactsAgree = (grants) =>
  grants.every((grant) =>
    grants.every(
      (other) =>
        other.grant_id === grant.grant_id ||
        other.client_id !== grant.client_id ||
        (other.owner_principal === grant.owner_principal &&
          other.tenant === grant.tenant &&
          other.verification_state === grant.verification_state &&
          JSON.stringify(other.catalog_scopes) === JSON.stringify(grant.catalog_scopes)),
    ),
  );

function callTracesToToken(call, byEvent, byGrant) {
  const token = byEvent.get(call.caused_by_event_id);
  const grant = byGrant.get(token?.grant_id);
  return (
    !Object.hasOwn(call, 'grant_id') &&
    !Object.hasOwn(call, 'credential_lineage') &&
    token?.kind === 'access-token-issued' &&
    Boolean(grant) &&
    call.client_id === token.client_id &&
    call.client_id === grant.client_id &&
    token.credential_lineage === grant.refresh_lineage &&
    call.resource === PROTECTED_SCOPE
  );
}

function validGrantTimeline(grant, timeline, created, tokens, calls, remediation) {
  if (
    created.length !== 1 ||
    tokens.length < 1 ||
    calls.length > tokens.length ||
    new Set(calls.map((call) => call.caused_by_event_id)).size !== calls.length
  ) {
    return false;
  }
  const tokenById = new Map(tokens.map((token) => [token.event_id, token]));
  return (
    created[0].time === grant.issue_time &&
    created[0].caused_by_event_id === null &&
    created[0].principal_binding === grant.principal_binding &&
    created[0].client_id === grant.client_id &&
    tokens.every(
      (token) =>
        token.caused_by_event_id === created[0].event_id &&
        token.time > created[0].time &&
        token.client_id === grant.client_id,
    ) &&
    timeline.every((event) => event.credential_lineage === grant.refresh_lineage) &&
    calls.every(
      (call) =>
        tokenById.has(call.caused_by_event_id) &&
        call.time > tokenById.get(call.caused_by_event_id).time &&
        call.resource === PROTECTED_SCOPE,
    ) &&
    (!remediation.revoked_grant_ids.includes(grant.grant_id) ||
      tokens.every((token) => token.time <= remediation.reset_time))
  );
}

function validMatchedPairs(grants, labels, targetCount) {
  const pairs = [...Map.groupBy(grants, (grant) => grant.client_id).values()].filter(
    (items) => items.length > 1,
  );
  if (pairs.length !== 2 || pairs.some((items) => items.length !== 2)) {
    return false;
  }
  const pairHas = (items, label) => items.some((grant) => labels[grant.grant_id] === label);
  return (
    pairs.every(
      (items) =>
        pairHas(items, 'same-user-survivor') &&
        (pairHas(items, 'benign-other') || pairHas(items, 'malicious-missed-by-query')),
    ) &&
    pairs.some((items) => pairHas(items, 'benign-other')) &&
    (targetCount === 0 || pairs.some((items) => pairHas(items, 'malicious-missed-by-query')))
  );
}

/** Validate source facts and derive evaluator-only labels from authorization and causal access. */
export function validateIncident(incident) {
  if (!validIncidentShape(incident)) {
    return fail('incident shape or base policy');
  }
  const { grants, registry, remediation, events } = incident;
  if (
    !unique(grants.map((grant) => grant.grant_id)) ||
    !unique(registry.map((row) => row.policy_entry_id)) ||
    !unique(events.map((event) => event.event_id)) ||
    grants.some((grant) => !validGrantFacts(grant, remediation?.compromised_user))
  ) {
    return fail('grant identifiers or facts');
  }
  if (!sharedClientFactsAgree(grants)) {
    return fail('shared client has inconsistent app facts');
  }
  const defect = FAMILY_DEFECT[remediation?.query_relationship];
  if (
    !defect ||
    remediation.defect_enumerated !== defect.enumerated ||
    remediation.password_reset !== true ||
    remediation.sessions_revoked !== true ||
    !validTime(remediation.reset_time) ||
    !remediation.reset_event_id ||
    !Array.isArray(remediation.revoked_grant_ids) ||
    !unique(remediation.revoked_grant_ids) ||
    grants.some((grant) => grant.issue_time >= remediation.reset_time)
  ) {
    return fail('reset facts');
  }
  const computedRevoked = computeRevokedGrantIds(grants, registry, remediation);
  if (
    computedRevoked.length !== remediation.revoked_grant_ids.length ||
    computedRevoked.some((id) => !remediation.revoked_grant_ids.includes(id))
  ) {
    return fail('revocation does not match defective query');
  }
  if (
    events.some(
      (event, index) =>
        !event.event_id ||
        !validTime(event.time) ||
        event.arrival_index !== index ||
        ![
          'delegated-grant-created',
          'compromised-user-remediated',
          'access-token-issued',
          'protected-export-call',
        ].includes(event.kind),
    )
  ) {
    return fail('event identifiers, times, or arrival order');
  }
  const byEvent = new Map(events.map((event) => [event.event_id, event]));
  if (
    events.some(
      (event) =>
        event.caused_by_event_id !== null &&
        (!byEvent.has(event.caused_by_event_id) ||
          byEvent.get(event.caused_by_event_id).time >= event.time),
    )
  ) {
    return fail('causal parent event is missing or not earlier');
  }
  const reset = byEvent.get(remediation.reset_event_id);
  if (
    events.filter((event) => event.kind === 'compromised-user-remediated').length !== 1 ||
    reset?.kind !== 'compromised-user-remediated' ||
    reset.time !== remediation.reset_time ||
    reset.caused_by_event_id !== null ||
    reset.compromised_user !== remediation.compromised_user ||
    reset.password_reset !== true ||
    reset.sessions_revoked !== true ||
    !Array.isArray(reset.revoked_grant_ids) ||
    reset.revoked_grant_ids.length !== remediation.revoked_grant_ids.length ||
    reset.revoked_grant_ids.some((id) => !remediation.revoked_grant_ids.includes(id))
  ) {
    return fail('reset event mismatch');
  }
  const byGrant = new Map(grants.map((grant) => [grant.grant_id, grant]));
  const protectedCalls = events.filter((event) => event.kind === 'protected-export-call');
  if (protectedCalls.some((call) => !callTracesToToken(call, byEvent, byGrant))) {
    return fail('protected call does not trace to its token and client');
  }
  if (
    protectedCalls.some(
      (call) =>
        call.time > remediation.reset_time &&
        byEvent.get(call.caused_by_event_id).time <= remediation.reset_time,
    )
  ) {
    return fail('post-reset call from pre-reset token is outside this contract');
  }
  const labels = {};
  const targetGrantIds = [];
  for (const grant of grants) {
    const timeline = events.filter((event) => event.grant_id === grant.grant_id);
    const created = timeline.filter((event) => event.kind === 'delegated-grant-created');
    const tokens = timeline.filter((event) => event.kind === 'access-token-issued');
    const tokenIds = new Set(tokens.map((token) => token.event_id));
    const calls = protectedCalls.filter((call) => tokenIds.has(call.caused_by_event_id));
    if (!validGrantTimeline(grant, timeline, created, tokens, calls, remediation)) {
      return fail('broken grant timeline: ' + grant.grant_id);
    }
    const postResetCalls = calls.filter((call) => call.time > remediation.reset_time);
    const accessedPostReset = postResetCalls.length > 0;
    if (
      accessedPostReset &&
      authorizedByJoin(grant, registry, grant.issue_time) &&
      postResetCalls.some((call) => !authorizedByJoin(grant, registry, call.time))
    ) {
      return fail('approval did not remain valid through protected call');
    }
    const label = labelFor(
      {
        ...grant,
        accessed_post_reset: accessedPostReset,
        call_time: calls.length ? Math.min(...calls.map((call) => call.time)) : null,
      },
      registry,
      remediation,
    );
    if (label === 'ambiguous') {
      return fail('ambiguous grant: ' + grant.grant_id);
    }
    labels[grant.grant_id] = label;
    if (label === 'malicious-missed-by-query') {
      targetGrantIds.push(grant.grant_id);
    }
  }
  if (
    events.some(
      (event) =>
        !['compromised-user-remediated', 'protected-export-call'].includes(event.kind) &&
        !grants.some((grant) => grant.grant_id === event.grant_id),
    ) ||
    targetGrantIds.length > 2 ||
    !Object.values(labels).includes('same-user-survivor') ||
    !Object.values(labels).includes('unauthorized-revoked') ||
    !Object.values(labels).includes('benign-other')
  ) {
    return fail('orphan event or missing incident controls');
  }
  if (!validMatchedPairs(grants, labels, targetGrantIds.length)) {
    return fail('missing matched same-client pairs');
  }
  return { ok: true, labels, target_grant_ids: targetGrantIds };
}
