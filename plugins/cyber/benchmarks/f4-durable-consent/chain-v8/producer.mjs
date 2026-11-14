// F4 v8: balanced near-match registry rows in native v6 sessions.
import crypto from 'node:crypto';

import { createOffenseSession, scoreOffense, stepOffense } from '../chain-v3/offense.mjs';
import { createAuthorizedContinuation, stepAuthorizedContinuation } from '../chain-v4/producer.mjs';
import { createCandidateSession, produceNativeBatchV6 } from '../chain-v6/producer.mjs';
import {
  authorizedByJoin,
  createGrant,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const choose = (text, modulus) => Number.parseInt(sha(text).slice(0, 8), 16) % modulus;

function checked(session, tool, args = {}) {
  const result = stepOffense(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v8 ${tool}: ${result.reason}`);
  }
  return result;
}

function checkedAuthorized(session, tool, args) {
  const result = stepAuthorizedContinuation(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v8 authorized ${tool}: ${result.reason}`);
  }
  return result;
}

function addNearMatch(session, grant, spec) {
  const mode = choose(`${spec.seed}|${spec.family}|${grant.grant_id}|predicate`, 2)
    ? 'time'
    : 'route';
  const row = {
    policy_entry_id: `policy-${sha(`${spec.seed}|${spec.family}|${grant.grant_id}|row`).slice(0, 24)}`,
    client_or_app_selector: grant.client_id,
    tenant_selector: grant.tenant,
    principal_selector: grant.principal_binding,
    scope_selector: [...grant.scopes],
    approval_route_selector: mode === 'route' ? 'self-service-standard' : grant.approval_route,
    valid_from: 0,
    valid_until: mode === 'time' ? grant.issue_time - 1 : null,
    revoked_at: null,
    issuer: 'enterprise-policy',
    approval_ref: `approval-${sha(`${grant.grant_id}|approval|${spec.seed}`).slice(0, 24)}`,
  };
  if (entryCovers(row, grant) === entryValidAt(row, grant.issue_time)) {
    throw new Error('v8 row must fail exactly one predicate');
  }
  const positions = session.registry.flatMap((entry, index) =>
    entry.client_or_app_selector === grant.client_id ? [index] : [],
  );
  if (positions.length !== 3) {
    throw new Error('v8 expected three native client rows');
  }
  const localPosition = choose(`${spec.seed}|${spec.family}|${grant.grant_id}|position`, 4);
  const insertion = localPosition === 3 ? positions[2] + 1 : positions[localPosition];
  session.registry.splice(insertion, 0, row);
  return { mode, localPosition, row };
}

function recapture(spec, app, index, original) {
  const nonce = sha(`native|${spec.seed}|${spec.family}|${index}|${app.arrangement_id}`);
  const mutation = index === 2 ? 'expired' : index === 3 ? 'route' : null;
  const session = mutation
    ? createCandidateSession(spec, app, index, mutation)
    : createOffenseSession({ ...spec, nonce });
  const candidateGrant = createGrant(app, spec);
  const expectedAuthorized = index !== 0 && !mutation;
  if (
    authorizedByJoin(candidateGrant, session.registry, candidateGrant.issue_time) !==
    expectedAuthorized
  ) {
    throw new Error('v8 baseline authorization mismatch');
  }
  addNearMatch(session, candidateGrant, spec);
  if (
    authorizedByJoin(candidateGrant, session.registry, candidateGrant.issue_time) !==
    expectedAuthorized
  ) {
    throw new Error('v8 near-match changed authorization truth');
  }

  const registration = checked(session, 'register-app', { arrangement_id: app.arrangement_id });
  const consent = checked(session, 'grant-consent', {
    client_id: registration.client_id,
    scope: PROTECTED_SCOPE,
  });
  const reset = checked(session, 'run-remediation');
  let continuationEvents = [];
  if (reset.terminal === 'grant-authorized') {
    if (!expectedAuthorized) {
      throw new Error('v8 unauthorized grant became authorized');
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
  } else if (!session.finished) {
    const refreshed = checked(session, 'refresh-access', {
      refresh_token: consent.refresh_token,
    });
    const called = checked(session, 'call-protected-api', {
      access_token: refreshed.access_token,
    });
    const read = checked(session, 'read-export', { export_ref: called.export_ref });
    checked(session, 'submit', { value: read.value });
    if (!scoreOffense(session).success) {
      throw new Error('v8 unauthorized native continuation failed');
    }
  }
  const { _attacker_created_this_run: _privateMarker, ...grant } = session.grant;
  const nativeEvents = [...session.events, ...continuationEvents];
  const events = nativeEvents.map((event, arrivalIndex) => ({
    ...event,
    arrival_index: arrivalIndex,
    caused_by_event_id: arrivalIndex ? nativeEvents[arrivalIndex - 1].event_id : null,
  }));
  if (
    JSON.stringify(grant) !== JSON.stringify(original.grant) ||
    JSON.stringify(session.remediation) !== JSON.stringify(original.remediation) ||
    JSON.stringify(events) !== JSON.stringify(original.events)
  ) {
    throw new Error('v8 native capture differs from v6 outside the registry');
  }
  const registry = session.registry
    .filter((entry) => [grant.client_id, '*'].includes(entry.client_or_app_selector))
    .map((entry) => ({ ...entry }));
  if (registry.length !== original.registry.length + 1) {
    throw new Error('v8 registry count mismatch');
  }
  return { ...original, registry };
}

export function produceNativeBatchV8(spec) {
  const baseline = produceNativeBatchV6(spec);
  const catalog = createOffenseSession({ ...spec, nonce: `catalog|${spec.seed}|${spec.family}` });
  const target = catalog.apps.find((app) => app._target);
  const survivors = catalog.apps.filter((app) => app._cohort && !app._target);
  if (!target || survivors.length !== 11) {
    throw new Error('v8 candidate population mismatch');
  }
  const byGrant = new Map(baseline.captures.map((capture) => [capture.grant.grant_id, capture]));
  const recaptured = [target, ...survivors].map((app, index) => {
    const grant = createGrant(app, spec);
    const original = byGrant.get(grant.grant_id);
    if (!original) {
      throw new Error('v8 baseline grant missing');
    }
    return recapture(spec, app, index, original);
  });
  const replacements = new Map(recaptured.map((capture) => [capture.grant.grant_id, capture]));
  return {
    ...baseline,
    captures: baseline.captures.map(
      (capture) => replacements.get(capture.grant.grant_id) ?? capture,
    ),
  };
}
