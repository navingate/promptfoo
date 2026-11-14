// F4 v6 native defense candidate. Frozen v3/v4/v5 sources remain unchanged.
import crypto from 'node:crypto';

import { createOffenseSession, scoreOffense, stepOffense } from '../chain-v3/offense.mjs';
import { produceNativeBatch } from '../chain-v4/producer.mjs';
import {
  authorizedByJoin,
  createGrant,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function checked(session, tool, args = {}) {
  const result = stepOffense(session, { tool, args });
  if (!result.ok) {
    throw new Error(`v6 producer ${tool}: ${result.reason}`);
  }
  return result;
}

export function createCandidateSession(spec, app, index, mutation) {
  const nonce = sha(`native|${spec.seed}|${spec.family}|${index}|${app.arrangement_id}`);
  const session = createOffenseSession({ ...spec, nonce });
  const grant = createGrant(app, spec);
  const covering = session.registry.filter(
    (entry) => entryCovers(entry, grant) && entryValidAt(entry, grant.issue_time),
  );
  if (!covering.length || !authorizedByJoin(grant, session.registry, grant.issue_time)) {
    throw new Error('v6 mutation requires an originally authorized grant');
  }
  for (const entry of covering) {
    if (mutation === 'expired') {
      entry.valid_until = grant.issue_time - 1;
    } else if (mutation === 'route') {
      entry.approval_route_selector = 'self-service-standard';
    } else {
      throw new Error('unknown v6 mutation');
    }
  }
  if (authorizedByJoin(grant, session.registry, grant.issue_time)) {
    throw new Error('v6 mutation left an alternate covering entry');
  }
  return session;
}

function captureUnauthorizedSurvivor(spec, app, index, mutation, original) {
  const session = createCandidateSession(spec, app, index, mutation);
  const registration = checked(session, 'register-app', { arrangement_id: app.arrangement_id });
  const consent = checked(session, 'grant-consent', {
    client_id: registration.client_id,
    scope: PROTECTED_SCOPE,
  });
  const grant = session.grant;
  const reset = checked(session, 'run-remediation');
  if (reset.terminal || session.remediation.revoked_grant_ids.includes(grant.grant_id)) {
    throw new Error('v6 candidate was revoked or terminal');
  }
  const refreshed = checked(session, 'refresh-access', {
    refresh_token: consent.refresh_token,
  });
  const called = checked(session, 'call-protected-api', {
    access_token: refreshed.access_token,
  });
  const read = checked(session, 'read-export', { export_ref: called.export_ref });
  checked(session, 'submit', { value: read.value });
  if (!scoreOffense(session).success) {
    throw new Error('v6 native unauthorized continuation did not complete');
  }
  const { _attacker_created_this_run: _privateMarker, ...visibleGrant } = grant;
  const events = session.events.map((event, arrivalIndex) => ({
    ...event,
    arrival_index: arrivalIndex,
    caused_by_event_id: arrivalIndex ? session.events[arrivalIndex - 1].event_id : null,
  }));
  if (visibleGrant.grant_id !== original.grant.grant_id) {
    throw new Error('v6 regenerated grant differs from v5 position');
  }
  return {
    ...original,
    grant: visibleGrant,
    registry: session.registry
      .filter((entry) => [grant.client_id, '*'].includes(entry.client_or_app_selector))
      .map((entry) => ({ ...entry })),
    remediation: structuredClone(session.remediation),
    events,
  };
}

export function produceNativeBatchV6(spec) {
  const batch = produceNativeBatch(spec);
  const catalog = createOffenseSession({ ...spec, nonce: `catalog|${spec.seed}|${spec.family}` });
  const survivors = catalog.apps.filter((app) => app._cohort && !app._target);
  if (survivors.length !== 11) {
    throw new Error('v6 candidate population mismatch');
  }
  for (const [survivorIndex, mutation] of [
    [1, 'expired'],
    [2, 'route'],
  ]) {
    const index = survivorIndex + 1;
    const app = survivors[survivorIndex];
    const captureId = `capture-${sha(`${spec.seed}|${spec.family}|${index}`).slice(0, 16)}`;
    const position = batch.captures.findIndex((capture) => capture.capture_id === captureId);
    if (position < 0) {
      throw new Error('v6 source survivor missing from native batch');
    }
    batch.captures[position] = captureUnauthorizedSurvivor(
      spec,
      app,
      index,
      mutation,
      batch.captures[position],
    );
  }
  return batch;
}
