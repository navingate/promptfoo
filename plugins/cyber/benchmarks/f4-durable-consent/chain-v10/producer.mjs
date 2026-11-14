// Fresh v10 captures from native consent, remediation, and continuation tools.
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

const TYPES = ['user-consent', 'partner-consent', 'admin-consent'];
const MODES = {
  malicious: ['registry-failed', 'base-policy-near-miss'],
  authorized: ['registry-covered', 'registry-covered-out-of-catalog', 'base-policy-only'],
  revoked: ['revoked'],
};
const EXTRA_SCOPES = ['billing.export', 'directory.export', 'audit.export', 'vault.export'];
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const number = (value, modulus) => Number.parseInt(hash(value).slice(0, 8), 16) % modulus;
const sortByHash = (items, salt, key) =>
  [...items].sort((a, b) => hash(`${salt}|${key(a)}`).localeCompare(hash(`${salt}|${key(b)}`)));

function checked(session, tool, args = {}) {
  const result = stepOffense(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v10 ${tool}: ${result.reason}`);
  }
  return result;
}

function checkedAuthorized(session, tool, args) {
  const result = stepAuthorizedContinuation(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v10 authorized ${tool}: ${result.reason}`);
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
  } else {
    throw new Error(`unknown predicate: ${mode}`);
  }
}

function registryRow(grant, spec, index, tag) {
  return {
    policy_entry_id: `policy-v10-${hash(`${spec.seed}|${spec.family}|${index}|${tag}`).slice(0, 24)}`,
    client_or_app_selector: grant.client_id,
    tenant_selector: grant.tenant,
    principal_selector: grant.principal_binding,
    scope_selector: [...grant.scopes],
    approval_route_selector: grant.approval_route,
    valid_from: 0,
    valid_until: null,
    revoked_at: null,
    issuer: 'enterprise-policy',
    approval_ref: `approval-v10-${hash(`${grant.grant_id}|${tag}`).slice(0, 24)}`,
  };
}

function configureApp(session, app, spec, index, slot) {
  const liveApp = session.apps.find((item) => item.arrangement_id === app.arrangement_id);
  if (!liveApp) {
    throw new Error('v10 native arrangement missing');
  }
  const { grantorType, authorizationMode } = slot;
  liveApp.grantor_type = grantorType;
  liveApp.tenant = number(`${spec.seed}|${spec.family}|${index}|tenant`, 2)
    ? 'internal'
    : 'external';
  liveApp.scopes = number(`${spec.seed}|${spec.family}|${index}|scope`, 2)
    ? ['reports.read', PROTECTED_SCOPE]
    : [PROTECTED_SCOPE];
  liveApp.approval_route =
    grantorType === 'admin-consent' &&
    ['base-policy-near-miss', 'registry-covered-out-of-catalog', 'base-policy-only'].includes(
      authorizationMode,
    )
      ? 'admin-approved'
      : grantorType === 'admin-consent'
        ? 'self-service-elevated'
        : number(`${spec.seed}|${spec.family}|${index}|route`, 2)
          ? 'self-service-elevated'
          : 'self-service-standard';
  liveApp.verification_state =
    grantorType === 'admin-consent'
      ? 'catalog-approved'
      : grantorType === 'partner-consent'
        ? 'verified'
        : 'unverified';
  if (['base-policy-near-miss', 'registry-covered-out-of-catalog'].includes(authorizationMode)) {
    const extra = EXTRA_SCOPES[number(`${spec.seed}|${spec.family}|extra`, EXTRA_SCOPES.length)];
    liveApp.scopes.push(extra);
  }
  return liveApp;
}

function configureRegistry(session, app, spec, index, slot) {
  const grant = createGrant(app, spec);
  const mode = slot.authorizationMode;
  const rows = session.registry.filter((row) =>
    [grant.client_id, '*'].includes(row.client_or_app_selector),
  );
  if (mode === 'registry-covered' || mode === 'registry-covered-out-of-catalog') {
    if (!rows.some((row) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time))) {
      session.registry.push(registryRow(grant, spec, index, 'cover'));
    }
  } else {
    const failureMode = ['route', 'time', 'tenant', 'principal'][
      number(`${spec.seed}|${spec.family}|${index}|mode`, 4)
    ];
    for (const row of rows) {
      if (mode === 'base-policy-near-miss') {
        failOnePredicate(row, grant, failureMode);
      } else if (entryCovers(row, grant) && entryValidAt(row, grant.issue_time)) {
        failOnePredicate(row, grant, failureMode);
      }
    }
  }
  if (mode !== 'revoked') {
    const near = registryRow(grant, spec, index, 'near');
    failOnePredicate(
      near,
      grant,
      ['route', 'time', 'tenant', 'principal'][number(`${spec.seed}|${index}|near`, 4)],
    );
    session.registry.push(near);
  }
  const authorized = authorizedByJoin(grant, session.registry, grant.issue_time);
  if (authorized !== (slot.classification === 'authorized')) {
    throw new Error(`v10 authorization mismatch: ${slot.classification}/${mode}`);
  }
  if (mode === 'base-policy-near-miss') {
    const reduced = { ...grant, scopes: [PROTECTED_SCOPE] };
    if (
      session.registry.some(
        (row) => entryCovers(row, reduced) && entryValidAt(row, reduced.issue_time),
      )
    ) {
      throw new Error('v10 near miss has alternate registry authorization');
    }
  }
}

function captureOne(spec, app, index, slot, basePolicy) {
  const nonce = hash(`v10-native|${spec.seed}|${spec.family}|${index}|${app.arrangement_id}`);
  const session = createOffenseSession({ ...spec, nonce });
  const nativeApp = configureApp(session, app, spec, index, slot);
  configureRegistry(session, nativeApp, spec, index, slot);
  const registration = checked(session, 'register-app', {
    arrangement_id: nativeApp.arrangement_id,
  });
  const consent = checked(session, 'grant-consent', {
    client_id: registration.client_id,
    scope: PROTECTED_SCOPE,
  });
  const reset = checked(session, 'run-remediation');
  let continuationEvents = [];
  if (slot.classification === 'authorized') {
    if (reset.terminal !== 'grant-authorized') {
      throw new Error('authorized grant did not terminate');
    }
    const continuation = createAuthorizedContinuation(session, consent.refresh_token);
    const refreshed = checkedAuthorized(continuation, 'refresh-access', {
      refresh_token: consent.refresh_token,
    });
    const called = checkedAuthorized(continuation, 'call-protected-api', {
      access_token: refreshed.access_token,
    });
    checkedAuthorized(continuation, 'read-export', { export_ref: called.export_ref });
    continuationEvents = continuation.events;
  } else if (slot.classification === 'malicious') {
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
    capture_id: `capture-v10-${hash(`${spec.seed}|${spec.family}|${index}`).slice(0, 16)}`,
    grant,
    registry: sortByHash(
      session.registry
        .filter((row) => [grant.client_id, '*'].includes(row.client_or_app_selector))
        .map((row) => ({ ...row })),
      `${spec.seed}|${spec.family}|${index}|registry`,
      (row) => row.policy_entry_id,
    ),
    base_policy: structuredClone(basePolicy),
    remediation: structuredClone(session.remediation),
    events,
  };
}

export function produceNativeBatchV10(spec) {
  if (
    !Number.isSafeInteger(spec?.seed) ||
    typeof spec.family !== 'string' ||
    !Array.isArray(spec.slots) ||
    spec.slots.length !== 13 ||
    !Number.isInteger(spec.maliciousCount) ||
    ![1, 2].includes(spec.revokedCount) ||
    spec.slots.some(
      (slot) =>
        !MODES[slot?.classification]?.includes(slot.authorizationMode) ||
        !TYPES.includes(slot.grantorType) ||
        (['base-policy-near-miss', 'registry-covered-out-of-catalog', 'base-policy-only'].includes(
          slot.authorizationMode,
        ) &&
          slot.grantorType !== 'admin-consent'),
    ) ||
    spec.slots.filter((slot) => slot.classification === 'malicious').length !==
      spec.maliciousCount ||
    spec.slots.filter((slot) => slot.classification === 'revoked').length !== spec.revokedCount
  ) {
    throw new Error('invalid v10 allocated slots');
  }
  const catalog = createOffenseSession({
    ...spec,
    nonce: `v10-catalog|${spec.seed}|${spec.family}`,
  });
  const target = catalog.apps.find((app) => app._target);
  const survivors = catalog.apps.filter((app) => app._cohort && !app._target);
  const enumerated = catalog.apps.filter(
    (app) => !app._cohort && app.scopes.includes(PROTECTED_SCOPE),
  );
  if (!target || survivors.length !== 11 || enumerated.length < 2) {
    throw new Error('v10 candidate population mismatch');
  }
  const basePolicy = checked(catalog, 'read-authorization-registry').base_policy;
  const cohortApps = [
    target,
    ...sortByHash(
      survivors,
      `${spec.seed}|${spec.family}|survivors`,
      (app) => app.arrangement_id,
    ).slice(0, 12 - spec.revokedCount),
  ];
  const revokedApps = sortByHash(
    enumerated,
    `${spec.seed}|${spec.family}|revoked`,
    (app) => app.arrangement_id,
  ).slice(0, spec.revokedCount);
  const liveSlots = spec.slots.filter((slot) => slot.classification !== 'revoked');
  const revokedSlots = spec.slots.filter((slot) => slot.classification === 'revoked');
  const arrangements = [
    ...cohortApps.map((app, index) => ({ app, slot: liveSlots[index] })),
    ...revokedApps.map((app, index) => ({ app, slot: revokedSlots[index] })),
  ];
  const captures = sortByHash(
    arrangements.map(({ app, slot }, index) => captureOne(spec, app, index, slot, basePolicy)),
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
