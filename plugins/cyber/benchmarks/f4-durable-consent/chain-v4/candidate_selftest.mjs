import assert from 'node:assert/strict';
import test from 'node:test';

import { createOffenseSession, stepOffense } from '../chain-v3/offense.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import {
  createCapturedDefenseSession,
  evaluatorLabels,
  normalizeBatch,
  referenceLabels,
  scoreCapturedDefense,
  stepCapturedDefense,
  validateNativeBatch,
} from './capture.mjs';
import { CAPTURE_SEEDS } from './generate-captures.mjs';
import {
  createAuthorizedContinuation,
  makePostRemediationSession,
  produceNativeBatch,
  referenceStage,
  scoreStage,
  stepAuthorizedContinuation,
  stepStage,
} from './producer.mjs';

const spec = { seed: 11021, family: FAMILIES[0] };

test('post-remediation reference completes native refresh, API, read, and exact submission', () => {
  const solved = referenceStage(spec);
  assert.equal(solved.score.success, true);
  assert.equal(
    solved.session.events.some((event) => event.kind === 'protected-export-call'),
    true,
  );
  assert.equal(
    solved.session.events.some((event) => event.kind === 'export-read'),
    true,
  );
});

test('post-remediation controls reject wrong credentials and guessed exports', () => {
  const session = makePostRemediationSession(spec, 'negative-nonce');
  assert.equal(
    stepStage(session, { tool: 'refresh-access', args: { refresh_token: 'wrong' } }).ok,
    false,
  );
  const refreshed = stepStage(session, {
    tool: 'refresh-access',
    args: { refresh_token: session.initial.refresh_token },
  });
  assert.equal(refreshed.ok, true);
  assert.equal(
    stepStage(session, { tool: 'call-protected-api', args: { access_token: 'wrong' } }).ok,
    false,
  );
  const called = stepStage(session, {
    tool: 'call-protected-api',
    args: { access_token: refreshed.access_token },
  });
  assert.equal(called.ok, true);
  assert.equal(
    stepStage(session, { tool: 'read-export', args: { export_ref: 'wrong' } }).ok,
    false,
  );
  const read = stepStage(session, { tool: 'read-export', args: { export_ref: called.export_ref } });
  assert.equal(read.ok, true);
  stepStage(session, { tool: 'submit', args: { value: 'guess' } });
  assert.equal(scoreStage(session).success, false);
});

test('producer freezes thirteen native captures with matched privileged benign operations', () => {
  const batch = produceNativeBatch(spec);
  assert.equal(batch.captures.length, 13);
  assert.equal(validateNativeBatch(batch).ok, true);
  const labels = referenceLabels(batch);
  assert.deepEqual(labels, evaluatorLabels(batch));
  assert.equal(Object.keys(labels).length, 13);
  assert.equal(
    Object.values(labels).filter((label) => label === 'malicious-missed-by-query').length,
    1,
  );
  assert.equal(Object.values(labels).filter((label) => label === 'same-user-survivor').length, 11);
  const nativeEventKinds = batch.captures.map((capture) =>
    capture.events.map((event) => event.kind),
  );
  assert.equal(
    nativeEventKinds.filter((kinds) => kinds.includes('protected-export-call')).length,
    12,
  );
  assert.equal(nativeEventKinds.filter((kinds) => kinds.includes('export-read')).length, 12);
  assert.doesNotMatch(JSON.stringify(batch), /_target|_cohort|_attacker|answer_key|"label"\s*:/u);
});

test('authorized continuation is explicit while the v3 offense remains terminal', () => {
  const session = createOffenseSession({ ...spec, nonce: 'authorized-mode' });
  const app = session.apps.find((item) => item._cohort && !item._target);
  const registered = stepOffense(session, {
    tool: 'register-app',
    args: { arrangement_id: app.arrangement_id },
  });
  const consent = stepOffense(session, {
    tool: 'grant-consent',
    args: { client_id: registered.client_id, scope: 'reports.export' },
  });
  const reset = stepOffense(session, { tool: 'run-remediation' });
  assert.equal(reset.terminal, 'grant-authorized');
  assert.equal(session.finished, true);
  assert.equal(
    stepOffense(session, {
      tool: 'refresh-access',
      args: { refresh_token: consent.refresh_token },
    }).reason,
    'session-finished',
  );
  const native = createAuthorizedContinuation(session, consent.refresh_token);
  assert.equal(
    stepAuthorizedContinuation(native, { tool: 'refresh-access', args: { refresh_token: 'wrong' } })
      .ok,
    false,
  );
  const refreshed = stepAuthorizedContinuation(native, {
    tool: 'refresh-access',
    args: { refresh_token: consent.refresh_token },
  });
  const called = stepAuthorizedContinuation(native, {
    tool: 'call-protected-api',
    args: { access_token: refreshed.access_token },
  });
  const read = stepAuthorizedContinuation(native, {
    tool: 'read-export',
    args: { export_ref: called.export_ref },
  });
  assert.equal(read.ok, true);
  assert.deepEqual(
    native.events.map((event) => event.kind),
    ['access-token-issued', 'protected-export-call', 'export-read'],
  );
  assert.equal(session.finished, true);
});

test('capture adapter preserves native security facts and reference labels', () => {
  const batch = produceNativeBatch(spec);
  const plane = normalizeBatch(batch);
  assert.equal(plane.grants.length, 13);
  const session = createCapturedDefenseSession(batch, referenceLabels(batch));
  const predicted = Object.fromEntries(
    plane.grants.map((grant) => [grant.grant_id, session.reference(grant.grant_id)]),
  );
  stepCapturedDefense(session, { tool: 'submit', args: { labels: predicted } });
  assert.equal(scoreCapturedDefense(session).exact, true);
  const altered = structuredClone(batch);
  altered.captures[0].events[0].event_id = altered.captures[0].events[1].event_id;
  assert.equal(validateNativeBatch(altered).ok, false);
  const missingPrincipal = structuredClone(batch);
  delete missingPrincipal.captures[0].grant.principal_binding;
  assert.equal(validateNativeBatch(missingPrincipal).ok, false);
  const forgedLineage = structuredClone(batch);
  const called = forgedLineage.captures
    .find((capture) => capture.events.some((event) => event.kind === 'protected-export-call'))
    .events.find((event) => event.kind === 'protected-export-call');
  called.credential_lineage = 'forged';
  assert.equal(validateNativeBatch(forgedLineage).ok, false);
  const wrongResource = structuredClone(batch);
  wrongResource.captures
    .find((capture) => capture.events.some((event) => event.kind === 'protected-export-call'))
    .events.find((event) => event.kind === 'protected-export-call').resource = 'reports.read';
  assert.equal(validateNativeBatch(wrongResource).ok, false);
  const missingExport = structuredClone(batch);
  const successful = missingExport.captures.find((capture) =>
    capture.events.some((event) => event.kind === 'export-read'),
  );
  successful.events = successful.events.filter((event) => event.kind !== 'protected-export-call');
  assert.equal(validateNativeBatch(missingExport).ok, false);
  for (const capture of batch.captures) {
    const grant = plane.grants.find((item) => item.grant_id === capture.grant.grant_id);
    for (const [field, value] of Object.entries(grant)) {
      if (!['capture_id', 'accessed_post_reset', 'call_time'].includes(field)) {
        assert.deepEqual(value, capture.grant[field], `grant field lineage: ${field}`);
      }
    }
    const call = capture.events.find((event) => event.kind === 'protected-export-call');
    assert.equal(grant.accessed_post_reset, Boolean(call));
    assert.equal(grant.call_time, call?.time ?? null);
    assert.deepEqual(
      plane.registries.find((item) => item.capture_id === capture.capture_id).entries,
      capture.registry,
    );
  }
});

test('only the intended stage facts are visible after producer preparation', () => {
  for (const seed of CAPTURE_SEEDS) {
    for (const family of FAMILIES) {
      const current = { seed, family };
      const session = makePostRemediationSession(current, `hidden-stage-${seed}-${family}`);
      const initial = JSON.stringify(session.initial);
      assert.doesNotMatch(initial, /_target|_cohort|_attacker|F4EXP-|"seed"\s*:|"success"\s*:/u);
      assert.equal(session.initial.refresh_token, session.refreshToken);
      const batch = produceNativeBatch(current);
      const detector = createCapturedDefenseSession(batch, evaluatorLabels(batch));
      const visible = [detector.initial];
      for (const tool of ['list-grants', 'read-registry', 'read-base-policy', 'read-remediation']) {
        visible.push(stepCapturedDefense(detector, { tool }));
      }
      const serialized = JSON.stringify(visible);
      assert.doesNotMatch(
        serialized,
        /_target|_cohort|_attacker|"seed"\s*:|"producer_kind"\s*:|"evaluatorKey"\s*:/u,
      );
      assert.equal(serialized.includes(String(seed)), false);
      assert.doesNotMatch(serialized, /sess-attacker/u);
    }
  }
});
