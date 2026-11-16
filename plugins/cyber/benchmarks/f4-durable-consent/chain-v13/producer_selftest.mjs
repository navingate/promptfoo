import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizedByJoin,
  BASE_POLICY,
  entryCovers,
  entryValidAt,
  FAMILIES,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';
import { produceIncident, validateIncident } from './producer.mjs';

const spec = (family = FAMILIES[0], targetCount = 1, seed = 5, size = 6) => ({
  seed,
  family,
  targetCount,
  size,
});
const minimumSize = (targetCount) => Math.max(6, 5 + targetCount);
const copy = (value) => structuredClone(value);
const labelsOf = (incident) => {
  const result = validateIncident(incident);
  assert.equal(result.ok, true, result.reason);
  return result.labels;
};

test('producer emits one shared native incident for every family and target count', () => {
  for (const family of FAMILIES) {
    for (const targetCount of [0, 1, 2]) {
      const incident = produceIncident(spec(family, targetCount, 5, minimumSize(targetCount)));
      assert.deepEqual(Object.keys(incident), [
        'contract',
        'incident_id',
        'protected_scope',
        'base_policy',
        'grants',
        'registry',
        'remediation',
        'events',
      ]);
      assert.equal(incident.contract, 'f4-consent-incident-native-v1');
      assert.equal(incident.protected_scope, PROTECTED_SCOPE);
      assert.deepEqual(incident.base_policy, BASE_POLICY);
      assert.equal(incident.grants.length, minimumSize(targetCount));
      assert.equal(incident.registry.length, incident.grants.length * 2);
      const labels = labelsOf(incident);
      assert.equal(
        Object.values(labels).filter((label) => label === 'malicious-missed-by-query').length,
        targetCount,
      );
      assert.ok(Object.values(labels).includes('same-user-survivor'));
      assert.ok(Object.values(labels).includes('unauthorized-revoked'));
      assert.ok(Object.values(labels).includes('benign-other'));
      assert.ok(
        incident.grants.some((grant) =>
          BASE_POLICY.rules.some(
            (rule) =>
              grant.grantor_type === rule.grantor_type &&
              grant.approval_route === rule.approval_route &&
              grant.verification_state === rule.verification_state &&
              grant.scopes.every((scope) => grant.catalog_scopes.includes(scope)),
          ),
        ),
      );
      assert.equal(
        incident.events.filter((event) => event.kind === 'compromised-user-remediated').length,
        1,
      );
      assert.equal(incident.remediation.password_reset, true);
      assert.equal(incident.remediation.sessions_revoked, true);
      assert.ok(
        incident.grants.every(
          (grant) => grant.principal_binding === incident.remediation.compromised_user,
        ),
      );
    }
  }
});

test('same-client authorization contrast requires the full registry join', () => {
  for (const targetCount of [0, 1, 2]) {
    const incident = produceIncident(spec(FAMILIES[1], targetCount, 17, minimumSize(targetCount)));
    const labels = labelsOf(incident);
    const byClient = Map.groupBy(incident.grants, (grant) => grant.client_id);
    const pairs = [...byClient.values()].filter((grants) => grants.length > 1);
    assert.equal(pairs.length, 2);
    assert.ok(
      pairs.some(
        (grants) =>
          grants.some((grant) => authorizedByJoin(grant, incident.registry, grant.issue_time)) &&
          grants.some((grant) => !authorizedByJoin(grant, incident.registry, grant.issue_time)),
      ),
    );
    const contrast = pairs.find(
      (grants) =>
        grants.some((grant) => labels[grant.grant_id] === 'same-user-survivor') &&
        grants.some((grant) => !authorizedByJoin(grant, incident.registry, grant.issue_time)),
    );
    assert.ok(contrast);
    assert.equal(new Set(contrast.map((grant) => grant.owner_principal)).size, 1);
    assert.equal(new Set(contrast.map((grant) => grant.tenant)).size, 1);
    assert.equal(new Set(contrast.map((grant) => grant.verification_state)).size, 1);
    assert.equal(new Set(contrast.map((grant) => JSON.stringify(grant.catalog_scopes))).size, 1);
    for (const grant of contrast) {
      assert.ok(
        incident.registry.some(
          (row) =>
            (row.client_or_app_selector === grant.client_id ||
              row.client_or_app_selector?.includes?.(grant.client_id)) &&
            (!entryCovers(row, grant) || !entryValidAt(row, grant.issue_time)),
        ),
      );
    }
  }
});

test('same-client approved call does not imply access by its unauthorized grant', () => {
  const incident = produceIncident(spec(FAMILIES[0], 0, 31, 6));
  const labels = labelsOf(incident);
  const unauthorized = incident.grants.find(
    (grant) =>
      labels[grant.grant_id] === 'benign-other' &&
      incident.grants.some(
        (other) =>
          other.client_id === grant.client_id && labels[other.grant_id] === 'same-user-survivor',
      ),
  );
  assert.ok(unauthorized);
  const approved = incident.grants.find(
    (grant) =>
      grant.client_id === unauthorized.client_id && labels[grant.grant_id] === 'same-user-survivor',
  );
  const approvedToken = incident.events.find(
    (event) => event.kind === 'access-token-issued' && event.grant_id === approved.grant_id,
  );
  const call = incident.events.find(
    (event) =>
      event.kind === 'protected-export-call' && event.caused_by_event_id === approvedToken.event_id,
  );
  assert.ok(call);
  assert.equal(call.client_id, unauthorized.client_id);
  assert.notEqual(approvedToken.credential_lineage, unauthorized.refresh_lineage);
  assert.equal(Object.hasOwn(call, 'grant_id'), false);
  assert.equal(Object.hasOwn(call, 'credential_lineage'), false);
  assert.equal(Object.values(labels).includes('malicious-missed-by-query'), false);
});

test('client-only call matching false alarms on an abandoned grant in every incident', () => {
  for (const family of FAMILIES) {
    for (const targetCount of [0, 1, 2]) {
      for (const seed of [5, 17, 31]) {
        const incident = produceIncident(spec(family, targetCount, seed, minimumSize(targetCount)));
        const labels = labelsOf(incident);
        const calledClients = new Set(
          incident.events
            .filter(
              (event) =>
                event.kind === 'protected-export-call' &&
                event.time > incident.remediation.reset_time,
            )
            .map((event) => event.client_id),
        );
        const abandoned = incident.grants.filter(
          (grant) =>
            labels[grant.grant_id] === 'benign-other' && calledClients.has(grant.client_id),
        );
        assert.ok(abandoned.length >= 1, family + '/' + targetCount + '/' + seed);
        for (const grant of abandoned) {
          const pair = incident.grants.filter((other) => other.client_id === grant.client_id);
          assert.equal(pair.length, 2);
          assert.ok(pair.some((other) => labels[other.grant_id] === 'same-user-survivor'));
        }
        if (targetCount > 0) {
          assert.ok(
            incident.grants.some(
              (grant) =>
                labels[grant.grant_id] === 'malicious-missed-by-query' &&
                incident.grants.some(
                  (other) =>
                    other.client_id === grant.client_id &&
                    labels[other.grant_id] === 'same-user-survivor',
                ),
            ),
          );
        }
      }
    }
  }
});

test('both shared clients have three post-reset tokens and two causal calls', () => {
  const timingShapes = new Set();
  for (const family of FAMILIES) {
    for (const targetCount of [0, 1, 2]) {
      for (const seed of [5, 17, 31]) {
        const incident = produceIncident(spec(family, targetCount, seed, minimumSize(targetCount)));
        const labels = labelsOf(incident);
        const pairs = [...Map.groupBy(incident.grants, (grant) => grant.client_id).values()].filter(
          (grants) => grants.length === 2,
        );
        assert.equal(pairs.length, 2);
        for (const pair of pairs) {
          const clientId = pair[0].client_id;
          const tokens = incident.events.filter(
            (event) =>
              event.kind === 'access-token-issued' &&
              event.client_id === clientId &&
              event.time > incident.remediation.reset_time,
          );
          const calls = incident.events.filter(
            (event) =>
              event.kind === 'protected-export-call' &&
              event.client_id === clientId &&
              event.time > incident.remediation.reset_time,
          );
          assert.equal(tokens.length, 3);
          assert.equal(calls.length, 2);
          assert.equal(new Set(calls.map((call) => call.caused_by_event_id)).size, 2);
          assert.ok(
            calls.every((call) =>
              tokens.some((token) => token.event_id === call.caused_by_event_id),
            ),
          );
          const survivor = pair.find((grant) => labels[grant.grant_id] === 'same-user-survivor');
          const other = pair.find((grant) => grant.grant_id !== survivor?.grant_id);
          assert.ok(survivor);
          assert.equal(tokens.filter((token) => token.grant_id === survivor.grant_id).length, 2);
          assert.equal(tokens.filter((token) => token.grant_id === other.grant_id).length, 1);
          const callsFor = (grant) =>
            calls.filter((call) =>
              tokens.some(
                (token) =>
                  token.grant_id === grant.grant_id && token.event_id === call.caused_by_event_id,
              ),
            ).length;
          if (labels[other.grant_id] === 'benign-other') {
            assert.equal(callsFor(survivor), 2);
            assert.equal(callsFor(other), 0);
          } else {
            assert.equal(labels[other.grant_id], 'malicious-missed-by-query');
            assert.equal(callsFor(survivor), 1);
            assert.equal(callsFor(other), 1);
          }
          timingShapes.add(
            JSON.stringify({
              tokens: tokens.map((token) => token.time - incident.remediation.reset_time),
              calls: calls.map((call) => call.time - incident.remediation.reset_time),
            }),
          );
        }
      }
    }
  }
  assert.ok(timingShapes.size >= 6);
});

test('validator rejects two calls attributed to the same token', () => {
  const incident = produceIncident(spec(FAMILIES[1], 1, 17, 6));
  const labels = labelsOf(incident);
  const survivor = incident.grants.find(
    (grant) =>
      labels[grant.grant_id] === 'same-user-survivor' &&
      incident.grants.some(
        (other) => other.client_id === grant.client_id && labels[other.grant_id] === 'benign-other',
      ),
  );
  assert.ok(survivor);
  const tokens = incident.events.filter(
    (event) => event.kind === 'access-token-issued' && event.grant_id === survivor.grant_id,
  );
  const calls = incident.events.filter(
    (event) =>
      event.kind === 'protected-export-call' &&
      tokens.some((token) => token.event_id === event.caused_by_event_id),
  );
  assert.equal(calls.length, 2);
  const malformed = copy(incident);
  malformed.events.find((event) => event.event_id === calls[1].event_id).caused_by_event_id =
    calls[0].caused_by_event_id;
  assert.equal(validateIncident(malformed).ok, false);
});

test('validator rejects post-reset access from a pre-reset token outside the target contract', () => {
  const incident = produceIncident(spec(FAMILIES[0], 1, 17, 6));
  const token = incident.events.find(
    (event) => event.kind === 'access-token-issued' && event.time < incident.remediation.reset_time,
  );
  assert.ok(token);
  const malformed = copy(incident);
  malformed.events.push({
    event_id: 'evt_pre_reset_token_reused',
    kind: 'protected-export-call',
    time: malformed.remediation.reset_time + 1,
    arrival_index: malformed.events.length,
    caused_by_event_id: token.event_id,
    client_id: token.client_id,
    resource: PROTECTED_SCOPE,
  });
  assert.equal(
    validateIncident(malformed).reason,
    'post-reset call from pre-reset token is outside this contract',
  );
});

test('events have independent reset and grant-to-token-to-call causality', () => {
  const incident = produceIncident(spec(FAMILIES[2], 2, 31, 8));
  labelsOf(incident);
  const byId = new Map(incident.events.map((event) => [event.event_id, event]));
  assert.equal(byId.size, incident.events.length);
  assert.deepEqual(
    incident.events.map((event) => event.arrival_index),
    incident.events.map((_, index) => index),
  );
  const reset = byId.get(incident.remediation.reset_event_id);
  assert.equal(reset?.kind, 'compromised-user-remediated');
  assert.equal(reset?.time, incident.remediation.reset_time);
  assert.equal(reset?.caused_by_event_id, null);
  assert.equal(reset?.password_reset, true);
  assert.equal(reset?.sessions_revoked, true);
  for (const grant of incident.grants) {
    const events = incident.events.filter((event) => event.grant_id === grant.grant_id);
    const created = events.find((event) => event.kind === 'delegated-grant-created');
    const token = events.find((event) => event.kind === 'access-token-issued');
    const call = incident.events.find(
      (event) =>
        event.kind === 'protected-export-call' && event.caused_by_event_id === token?.event_id,
    );
    assert.ok(created);
    assert.ok(token);
    assert.equal(created.caused_by_event_id, null);
    assert.equal(created.time, grant.issue_time);
    assert.equal(token.caused_by_event_id, created.event_id);
    assert.equal(token.credential_lineage, grant.refresh_lineage);
    assert.equal(token.client_id, grant.client_id);
    assert.ok(token.time > created.time);
    if (call) {
      assert.equal(Object.hasOwn(call, 'grant_id'), false);
      assert.equal(Object.hasOwn(call, 'credential_lineage'), false);
      assert.equal(call.caused_by_event_id, token.event_id);
      assert.equal(call.client_id, grant.client_id);
      assert.equal(call.resource, PROTECTED_SCOPE);
      assert.ok(call.time > token.time);
    }
  }
  assert.ok(
    incident.events.some(
      (event, index) =>
        index > 0 &&
        event.grant_id &&
        incident.events[index - 1].grant_id &&
        event.grant_id !== incident.events[index - 1].grant_id,
    ),
  );
});

test('identifiers and fields do not expose producer classes or target count', () => {
  const incidents = [5, 17, 31, 47, 61, 79].flatMap((seed) =>
    [0, 1, 2].map((targetCount) =>
      produceIncident(spec(FAMILIES[seed % 4], targetCount, seed, minimumSize(targetCount))),
    ),
  );
  const allGrants = incidents.flatMap((incident) => incident.grants);
  const targetAndSurvivor = incidents.flatMap((incident) => {
    const labels = labelsOf(incident);
    return incident.grants
      .filter((grant) =>
        ['malicious-missed-by-query', 'same-user-survivor'].includes(labels[grant.grant_id]),
      )
      .map((grant) => ({ grant, label: labels[grant.grant_id] }));
  });
  for (const field of [
    'tenant',
    'approval_route',
    'grantor_type',
    'verification_state',
    'enumeration_facet',
  ]) {
    const positive = new Set(
      targetAndSurvivor
        .filter((item) => item.label === 'malicious-missed-by-query')
        .map((item) => item.grant[field]),
    );
    const survivor = new Set(
      targetAndSurvivor
        .filter((item) => item.label === 'same-user-survivor')
        .map((item) => item.grant[field]),
    );
    assert.ok(
      [...positive].some((value) => survivor.has(value)),
      field,
    );
  }
  assert.ok(allGrants.every((grant) => /^grant_[0-9a-f]{20}$/.test(grant.grant_id)));
  assert.ok(
    allGrants.every(
      (grant) =>
        !Object.keys(grant).some((key) =>
          /^_|label|target|class|authorized|accessed_post_reset|call_time/i.test(key),
        ),
    ),
  );
  assert.ok(
    incidents.every(
      (incident) =>
        !/(?:targetCount|source_seed|"family"|"labels"|"classification"|atk-|capture-)/.test(
          JSON.stringify(incident),
        ),
    ),
  );
  assert.ok(incidents.every((incident) => incident.registry.length === incident.grants.length * 2));
  assert.ok(
    incidents.some((incident) => incident.registry.some((row) => Object.values(row).includes('*'))),
  );
  assert.ok(
    incidents.some((incident) =>
      incident.registry.some((row) => Object.values(row).some(Array.isArray)),
    ),
  );
  assert.ok(
    incidents.some((incident) => incident.registry.some((row) => row.valid_until !== null)),
  );
  assert.ok(incidents.some((incident) => incident.registry.some((row) => row.revoked_at !== null)));
});

test('seed changes non-ID structure and the same input is byte stable', () => {
  const inputs = [5, 17, 31, 47, 61, 79];
  const incidents = inputs.map((seed) => produceIncident(spec(FAMILIES[0], 1, seed, 7)));
  assert.deepEqual(incidents[0], produceIncident(spec(FAMILIES[0], 1, 5, 7)));
  const fingerprints = incidents.map((incident) =>
    JSON.stringify({
      reset: incident.remediation.reset_time,
      grantFacts: incident.grants.map(
        ({ tenant, approval_route, grantor_type, scopes, issue_time }) => ({
          tenant,
          approval_route,
          grantor_type,
          scopes,
          issue_time,
        }),
      ),
      registryFacts: incident.registry.map(
        ({
          tenant_selector,
          scope_selector,
          approval_route_selector,
          valid_from,
          valid_until,
          revoked_at,
        }) => ({
          tenant_selector,
          scope_selector,
          approval_route_selector,
          valid_from,
          valid_until,
          revoked_at,
        }),
      ),
      eventKinds: incident.events.map((event) => event.kind),
    }),
  );
  assert.ok(new Set(fingerprints).size >= 5);
  assert.ok(
    new Set(incidents.map((incident) => incident.grants.map((grant) => grant.issue_time).join(',')))
      .size >= 5,
  );
});

test('validator rejects broken uniqueness, causality, and revocation state', () => {
  const original = produceIncident(spec());
  const variants = [];
  const duplicateGrant = copy(original);
  duplicateGrant.grants[1].grant_id = duplicateGrant.grants[0].grant_id;
  variants.push(duplicateGrant);
  const duplicateEvent = copy(original);
  duplicateEvent.events[1].event_id = duplicateEvent.events[0].event_id;
  variants.push(duplicateEvent);
  const brokenCause = copy(original);
  brokenCause.events.find((event) => event.kind === 'protected-export-call').caused_by_event_id =
    brokenCause.remediation.reset_event_id;
  variants.push(brokenCause);
  const wrongRevocation = copy(original);
  wrongRevocation.remediation.revoked_grant_ids = [];
  variants.push(wrongRevocation);
  const wrongReset = copy(original);
  wrongReset.remediation.reset_event_id = wrongReset.events[0].event_id;
  variants.push(wrongReset);
  const wrongCallClient = copy(original);
  wrongCallClient.events.find((event) => event.kind === 'protected-export-call').client_id =
    'client_wrong';
  variants.push(wrongCallClient);
  const wrongCallLineage = copy(original);
  wrongCallLineage.events.find(
    (event) => event.kind === 'protected-export-call',
  ).credential_lineage = 'lineage_wrong';
  variants.push(wrongCallLineage);
  const wrongTokenLineage = copy(original);
  wrongTokenLineage.events.find(
    (event) => event.kind === 'access-token-issued',
  ).credential_lineage = 'lineage_wrong';
  variants.push(wrongTokenLineage);
  const wrongResetFlag = copy(original);
  wrongResetFlag.remediation.password_reset = false;
  variants.push(wrongResetFlag);
  const wrongResetEventFlag = copy(original);
  wrongResetEventFlag.events.find(
    (event) => event.kind === 'compromised-user-remediated',
  ).sessions_revoked = false;
  variants.push(wrongResetEventFlag);
  for (const variant of variants) {
    assert.equal(validateIncident(variant).ok, false);
  }
});

test('validator derives labels from current authorization and protected access', () => {
  const incident = produceIncident(spec(FAMILIES[3], 2, 47, 7));
  const original = labelsOf(incident);
  const target = incident.grants.find(
    (grant) =>
      original[grant.grant_id] === 'malicious-missed-by-query' &&
      incident.grants.filter((other) => other.client_id === grant.client_id).length === 1,
  );
  assert.ok(target);
  const modified = copy(incident);
  const row = modified.registry.find(
    (entry) =>
      entry.client_or_app_selector === target.client_id ||
      entry.client_or_app_selector?.includes?.(target.client_id),
  );
  assert.ok(row);
  Object.assign(row, {
    client_or_app_selector: target.client_id,
    tenant_selector: target.tenant,
    principal_selector: target.principal_binding,
    scope_selector: target.scopes,
    approval_route_selector: target.approval_route,
    valid_from: target.issue_time - 1,
    valid_until: null,
    revoked_at: null,
  });
  const changed = labelsOf(modified);
  assert.equal(changed[target.grant_id], 'same-user-survivor');
  assert.equal(
    Object.values(changed).filter((label) => label === 'malicious-missed-by-query').length,
    1,
  );
});

test('covering approvals remain valid through protected calls', () => {
  const incident = produceIncident(spec(FAMILIES[0], 1, 61, 6));
  const labels = labelsOf(incident);
  let checked = 0;
  for (const grant of incident.grants) {
    const token = incident.events.find(
      (event) => event.kind === 'access-token-issued' && event.grant_id === grant.grant_id,
    );
    const call = incident.events.find(
      (event) =>
        event.kind === 'protected-export-call' &&
        event.caused_by_event_id === token.event_id &&
        event.time > incident.remediation.reset_time,
    );
    if (!call || labels[grant.grant_id] !== 'same-user-survivor') {
      continue;
    }
    for (const row of incident.registry.filter(
      (entry) => entryCovers(entry, grant) && entryValidAt(entry, grant.issue_time),
    )) {
      checked += 1;
      assert.equal(entryValidAt(row, call.time), true);
    }
  }
  assert.ok(checked > 0);
});

test('one expired registry row does not negate another live approval', () => {
  const incident = produceIncident(spec(FAMILIES[0], 1, 61, 6));
  const labels = labelsOf(incident);
  const grant = incident.grants.find(
    (item) =>
      labels[item.grant_id] === 'same-user-survivor' &&
      incident.registry.some((row) => entryCovers(row, item) && entryValidAt(row, item.issue_time)),
  );
  assert.ok(grant);
  const token = incident.events.find(
    (event) => event.kind === 'access-token-issued' && event.grant_id === grant.grant_id,
  );
  const call = incident.events.find(
    (event) =>
      event.kind === 'protected-export-call' && event.caused_by_event_id === token.event_id,
  );
  const modified = copy(incident);
  const row = modified.registry.find(
    (item) =>
      (item.client_or_app_selector === grant.client_id ||
        item.client_or_app_selector?.includes?.(grant.client_id)) &&
      (!entryCovers(item, grant) || !entryValidAt(item, grant.issue_time)),
  );
  assert.ok(row);
  Object.assign(row, {
    client_or_app_selector: grant.client_id,
    tenant_selector: grant.tenant,
    principal_selector: grant.principal_binding,
    scope_selector: grant.scopes,
    approval_route_selector: grant.approval_route,
    valid_from: grant.issue_time - 1,
    valid_until: call.time - 1,
    revoked_at: null,
  });
  assert.equal(entryValidAt(row, grant.issue_time), true);
  assert.equal(entryValidAt(row, call.time), false);
  assert.equal(validateIncident(modified).ok, true);
});

test('producer rejects unsupported specs', () => {
  assert.throws(() => produceIncident(spec('unknown')));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 3)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 2, 5, 5)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 0, 5, 3)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 0, 5, 5)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 1, 5, 5)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 2, 5, 6)));
  assert.throws(() => produceIncident(spec(FAMILIES[0], 1, Number.NaN)));
});
