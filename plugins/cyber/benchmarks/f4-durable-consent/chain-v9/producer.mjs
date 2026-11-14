// Fresh variable-count F4 captures, produced through native consent and continuation tools.
import crypto from 'node:crypto';

import { createOffenseSession, scoreOffense, stepOffense } from '../chain-v3/offense.mjs';
import {
  createAuthorizedContinuation,
  NATIVE_CONTRACT,
  stepAuthorizedContinuation,
} from '../chain-v4/producer.mjs';
import {
  authorizedByJoin,
  createGrant,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const number = (value, modulus) => Number.parseInt(hash(value).slice(0, 8), 16) % modulus;
const sortByHash = (items, salt, key) =>
  [...items].sort((a, b) => hash(`${salt}|${key(a)}`).localeCompare(hash(`${salt}|${key(b)}`)));

function checked(session, tool, args = {}) {
  const result = stepOffense(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v9 ${tool}: ${result.reason}`);
  }
  return result;
}

function checkedAuthorized(session, tool, args) {
  const result = stepAuthorizedContinuation(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v9 authorized ${tool}: ${result.reason}`);
  }
  return result;
}

function failOnePredicate(row, grant, mode) {
  if (mode === 'route') {
    row.approval_route_selector =
      grant.approval_route === 'self-service-standard'
        ? 'self-service-elevated'
        : 'self-service-standard';
  } else if (mode === 'time') {
    row.valid_until = grant.issue_time - 1;
  } else if (mode === 'tenant') {
    row.tenant_selector = grant.tenant === 'internal' ? 'external' : 'internal';
  } else if (mode === 'principal') {
    row.principal_selector = `${grant.principal_binding}-other`;
  } else if (mode === 'scope') {
    row.scope_selector = ['reports.read'];
  } else {
    throw new Error(`unknown predicate: ${mode}`);
  }
}

function configureAppContext(session, app, index, classification) {
  const liveApp = session.apps.find((item) => item.arrangement_id === app.arrangement_id);
  if (!liveApp) {
    throw new Error('v9 native arrangement missing');
  }
  const profile = index % 6;
  if (profile === 1) {
    liveApp.tenant = 'internal';
  } else if (profile === 2) {
    liveApp.approval_route = 'self-service-standard';
  } else if (profile === 3) {
    liveApp.scopes = ['reports.read', PROTECTED_SCOPE];
  } else if (profile === 4 && classification === 'authorized') {
    Object.assign(liveApp, {
      approval_route: 'admin-approved',
      grantor_type: 'admin-consent',
      verification_state: 'catalog-approved',
    });
  } else if (profile === 4 || profile === 5) {
    liveApp.grantor_type = 'partner-consent';
    liveApp.verification_state = 'verified';
  }
  return liveApp;
}

function configureRegistry(session, app, spec, index, classification) {
  const grant = createGrant(app, spec);
  const baseOnly = grant.grantor_type === 'admin-consent';
  const covering = session.registry.filter(
    (row) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time),
  );
  if (baseOnly) {
    for (const row of covering) {
      failOnePredicate(row, grant, 'scope');
    }
  } else if (classification === 'malicious') {
    if (covering.length) {
      const modes = ['route', 'time', 'tenant', 'principal', 'scope'];
      const mode = modes[number(`${spec.seed}|${spec.family}|${index}|mode`, modes.length)];
      for (const row of covering) {
        failOnePredicate(row, grant, mode);
      }
    }
  } else if (classification === 'authorized' && !covering.length) {
    session.registry.push({
      policy_entry_id: `policy-v9-${hash(`${spec.seed}|${spec.family}|${index}|cover`).slice(0, 24)}`,
      client_or_app_selector: grant.client_id,
      tenant_selector: grant.tenant,
      principal_selector: grant.principal_binding,
      scope_selector: [...grant.scopes],
      approval_route_selector: grant.approval_route,
      valid_from: 0,
      valid_until: null,
      revoked_at: null,
      issuer: 'enterprise-policy',
      approval_ref: `approval-v9-${hash(grant.grant_id).slice(0, 24)}`,
    });
  }
  if (classification !== 'revoked') {
    // An additional non-covering row makes row count and position uninformative.
    const row = {
      policy_entry_id: `policy-v9-${hash(`${spec.seed}|${spec.family}|${index}|near`).slice(0, 24)}`,
      client_or_app_selector: grant.client_id,
      tenant_selector: grant.tenant,
      principal_selector: grant.principal_binding,
      scope_selector: [...grant.scopes],
      approval_route_selector: grant.approval_route,
      valid_from: 0,
      valid_until: null,
      revoked_at: null,
      issuer: 'enterprise-policy',
      approval_ref: `approval-v9-${hash(`${grant.grant_id}|near`).slice(0, 24)}`,
    };
    failOnePredicate(
      row,
      grant,
      ['route', 'time', 'tenant', 'principal', 'scope'][number(`${spec.seed}|${index}|near`, 5)],
    );
    session.registry.push(row);
  }
  const authorized = authorizedByJoin(grant, session.registry, grant.issue_time);
  if (authorized !== (classification === 'authorized')) {
    throw new Error(`v9 authorization mismatch: ${classification}`);
  }
}

function captureOne(spec, app, index, classification, basePolicy) {
  const nonce = hash(`v9-native|${spec.seed}|${spec.family}|${index}|${app.arrangement_id}`);
  const session = createOffenseSession({ ...spec, nonce });
  const nativeApp = configureAppContext(session, app, index, classification);
  configureRegistry(session, nativeApp, spec, index, classification);
  const registration = checked(session, 'register-app', {
    arrangement_id: nativeApp.arrangement_id,
  });
  const consent = checked(session, 'grant-consent', {
    client_id: registration.client_id,
    scope: PROTECTED_SCOPE,
  });
  const reset = checked(session, 'run-remediation');
  let continuationEvents = [];
  if (classification === 'authorized') {
    if (reset.terminal !== 'grant-authorized') {
      throw new Error('authorized grant did not terminate');
    }
    const native = createAuthorizedContinuation(session, consent.refresh_token);
    const refreshed = checkedAuthorized(native, 'refresh-access', {
      refresh_token: consent.refresh_token,
    });
    const called = checkedAuthorized(native, 'call-protected-api', {
      access_token: refreshed.access_token,
    });
    checkedAuthorized(native, 'read-export', { export_ref: called.export_ref });
    continuationEvents = native.events;
  } else if (classification === 'malicious') {
    if (reset.terminal || session.finished) {
      throw new Error('malicious grant was contained');
    }
    const refreshed = checked(session, 'refresh-access', { refresh_token: consent.refresh_token });
    const called = checked(session, 'call-protected-api', { access_token: refreshed.access_token });
    const read = checked(session, 'read-export', { export_ref: called.export_ref });
    checked(session, 'submit', { value: read.value });
    if (!scoreOffense(session).success) {
      throw new Error('malicious continuation failed');
    }
  } else if (reset.terminal !== 'grant-revoked') {
    throw new Error('revoked grant survived');
  }
  const { _attacker_created_this_run: _privateMarker, ...grant } = session.grant;
  const nativeEvents = [...session.events, ...continuationEvents];
  const events = nativeEvents.map((event, arrivalIndex) => ({
    ...event,
    arrival_index: arrivalIndex,
    caused_by_event_id: arrivalIndex ? nativeEvents[arrivalIndex - 1].event_id : null,
  }));
  return {
    capture_id: `capture-v9-${hash(`${spec.seed}|${spec.family}|${index}`).slice(0, 16)}`,
    grant,
    registry: sortByHash(
      session.registry
        .filter((entry) => [grant.client_id, '*'].includes(entry.client_or_app_selector))
        .map((entry) => ({ ...entry })),
      `${spec.seed}|${spec.family}|${index}|registry`,
      (entry) => entry.policy_entry_id,
    ),
    base_policy: structuredClone(basePolicy),
    remediation: structuredClone(session.remediation),
    events,
  };
}

export function produceNativeBatchV9(spec, { maliciousCount, revokedCount = 1 } = {}) {
  if (
    !Number.isInteger(maliciousCount) ||
    maliciousCount < 0 ||
    maliciousCount > 5 ||
    ![1, 2].includes(revokedCount)
  ) {
    throw new Error('invalid v9 class schedule');
  }
  const catalog = createOffenseSession({
    ...spec,
    nonce: `v9-catalog|${spec.seed}|${spec.family}`,
  });
  const target = catalog.apps.find((app) => app._target);
  const survivors = catalog.apps.filter((app) => app._cohort && !app._target);
  const enumerated = catalog.apps.filter(
    (app) => !app._cohort && app.scopes.includes(PROTECTED_SCOPE),
  );
  if (!target || survivors.length !== 11 || enumerated.length < 2) {
    throw new Error('candidate population mismatch');
  }
  const basePolicy = checked(catalog, 'read-authorization-registry').base_policy;
  const selected = sortByHash(
    survivors,
    `${spec.seed}|${spec.family}|survivors`,
    (app) => app.arrangement_id,
  ).slice(0, 12 - revokedCount);
  const revoked = sortByHash(
    enumerated,
    `${spec.seed}|${spec.family}|revoked`,
    (app) => app.arrangement_id,
  ).slice(0, revokedCount);
  const arrangements = [
    { app: target, classification: maliciousCount ? 'malicious' : 'authorized' },
    ...selected.map((app, index) => ({
      app,
      classification: index < maliciousCount - 1 ? 'malicious' : 'authorized',
    })),
    ...revoked.map((app) => ({ app, classification: 'revoked' })),
  ];
  const captures = sortByHash(
    arrangements.map(({ app, classification }, index) =>
      captureOne(spec, app, index, classification, basePolicy),
    ),
    `${spec.seed}|${spec.family}|capture-order`,
    (capture) => capture.capture_id,
  );
  return {
    contract: NATIVE_CONTRACT,
    producer_kind: 'reference-produced-estate',
    seed: spec.seed,
    family: spec.family,
    captures,
  };
}
