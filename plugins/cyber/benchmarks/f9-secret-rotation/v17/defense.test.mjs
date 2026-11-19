import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import {
  createDefenseSession,
  inferDisposition,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from './defense.mjs';

const act = (session, tool, args = {}) => stepDefense(session, { tool, args });
const spec = { seed: 64001, family: 'cached-interval', subtype: 'malicious' };

test('independent staged reference solves all four native-capture outcomes', () => {
  for (const family of FAMILIES) {
    for (const subtype of SUBTYPES) {
      const result = referenceDefense({ seed: 64001, family, subtype });
      assert.equal(result.score.success, true, `${family}/${subtype}`);
      assert.equal(result.session.finished, true);
      assert.ok(result.session.action_ledger.length <= 60);
      assert.equal(result.score.triage_success, true);
      assert.equal(result.score.citation_success, true);
      assert.equal(result.score.service_preserved, true);
      const visible = [result.session.initial, result.session.evidence];
      assert.equal(JSON.stringify(visible).includes('evaluator'), false);
      assert.equal(JSON.stringify(visible).includes('subtype'), false);
      assert.equal(JSON.stringify(visible).includes('read-'), false);
      assert.equal(JSON.stringify(visible).includes('record-'), false);
    }
  }
});

test('causal citation is required even when the disposition label is right', () => {
  const session = createDefenseSession(spec);
  const events = act(session, 'events').events;
  const authorizations = act(session, 'authorizations').records;
  const judgment = inferDisposition({ events, authorizations, alert: session.initial.alert });
  const otherAuth = events.find(
    (event) => event.type === 'auth.attempt' && event.event_id !== judgment.auth_event_id,
  );
  act(session, 'declare', { ...judgment, auth_event_id: otherAuth.event_id });
  assert.equal(scoreDefense(session).triage_success, true);
  assert.equal(scoreDefense(session).citation_success, false);
});

test('premature global revocation causes a persistent outage', () => {
  const session = createDefenseSession(spec);
  const judgment = inferDisposition({
    events: act(session, 'events').events,
    authorizations: act(session, 'authorizations').records,
    alert: session.initial.alert,
  });
  act(session, 'declare', judgment);
  act(session, 'issue-new');
  const revoked = act(session, 'revoke-old');
  assert.equal(revoked.service_healthy, false);
  assert.equal(scoreDefense(session).avoidable_outage, true);
  assert.equal(scoreDefense(session).success, false);
});

test('one missed v1 consumer fails scope and service preservation', () => {
  const session = createDefenseSession({ ...spec, seed: 64003 });
  const judgment = inferDisposition({
    events: act(session, 'events').events,
    authorizations: act(session, 'authorizations').records,
    alert: session.initial.alert,
  });
  const consumers = act(session, 'consumers').bindings.filter(
    (item) => item.credential_ref === judgment.credential_ref && item.current_version === 'v1',
  );
  assert.ok(consumers.length >= 2);
  act(session, 'declare', judgment);
  act(session, 'issue-new');
  act(session, 'migrate', { consumer: consumers[0].consumer_ref });
  act(session, 'revoke-old');
  act(session, 'finish');
  const score = scoreDefense(session);
  assert.equal(score.scope_success, false);
  assert.equal(score.service_preserved, false);
  assert.equal(score.success, false);
});

test('unnecessary mutation invalidates a correctly triaged false positive', () => {
  const session = createDefenseSession({ ...spec, subtype: 'false-positive' });
  const judgment = inferDisposition({
    events: act(session, 'events').events,
    authorizations: act(session, 'authorizations').records,
    alert: session.initial.alert,
  });
  act(session, 'declare', judgment);
  act(session, 'issue-new');
  act(session, 'finish');
  assert.equal(scoreDefense(session).triage_success, true);
  assert.equal(scoreDefense(session).unnecessary_mutation, true);
  assert.equal(scoreDefense(session).success, false);
});

test('recovery started before supported triage fails safe ordering', () => {
  const reference = referenceDefense(spec);
  const session = createDefenseSession(spec);
  act(session, 'issue-new');
  for (const { tool, ...args } of reference.session.action_ledger) {
    if (tool !== 'issue-new') {
      act(session, tool, args);
    }
  }
  const score = scoreDefense(session);
  assert.equal(score.triage_success, true);
  assert.equal(score.citation_success, true);
  assert.equal(score.safe_ordering, false);
  assert.equal(score.success, false);
});
