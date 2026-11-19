import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefenseSession,
  inferDisposition,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from './defense.mjs';

const base = { seed: 102001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepDefense(session, { tool, args });

function inspect(subtype) {
  const session = createDefenseSession({ ...base, subtype });
  const events = act(session, 'events').events;
  const authorizations = act(session, 'authorizations').records;
  const judgment = inferDisposition({ events, authorizations, alert: session.initial.alert });
  return { session, events, authorizations, judgment };
}

test('authorized exercise needs independent approval-service confirmation to close', () => {
  const { session, authorizations, judgment } = inspect('breakglass');
  const unrelated = authorizations.find((item) => item.event_id !== judgment.authorization_id);
  assert.equal(
    act(session, 'verify-authorization', {
      authorization_id: unrelated.event_id,
      read_event_id: judgment.read_event_id,
      auth_event_id: judgment.auth_event_id,
    }).verified,
    false,
  );
  act(session, 'declare', judgment);
  act(session, 'finish');
  assert.equal(scoreDefense(session).triage_success, true);
  assert.equal(scoreDefense(session).verification_success, false);
  assert.equal(scoreDefense(session).success, false);

  const verified = inspect('breakglass');
  const result = act(verified.session, 'verify-authorization', {
    authorization_id: verified.judgment.authorization_id,
    read_event_id: verified.judgment.read_event_id,
    auth_event_id: verified.judgment.auth_event_id,
  });
  assert.deepEqual(result, { verified: true, signature: 'valid', status_at_read: 'active' });
  act(verified.session, 'declare', verified.judgment);
  act(verified.session, 'finish');
  assert.equal(scoreDefense(verified.session).success, true);
});

test('denied-read closure needs a gateway confirmation on the alerted causal chain', () => {
  const { session, events, judgment } = inspect('false-positive');
  const otherRead = events.find((item) => item.type === 'protected.read' && item.allowed);
  assert.equal(
    act(session, 'verify-denial', {
      read_event_id: otherRead.event_id,
      auth_event_id: judgment.auth_event_id,
    }).verified,
    false,
  );
  act(session, 'declare', judgment);
  act(session, 'finish');
  assert.equal(scoreDefense(session).verification_success, false);
  assert.equal(scoreDefense(session).success, false);

  const verified = inspect('false-positive');
  const result = act(verified.session, 'verify-denial', {
    read_event_id: verified.judgment.read_event_id,
    auth_event_id: verified.judgment.auth_event_id,
  });
  assert.equal(result.verified, true);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /^object-version-/);
  act(verified.session, 'declare', verified.judgment);
  act(verified.session, 'finish');
  assert.equal(scoreDefense(verified.session).success, true);
});

test('reference confirms both signed approval outcomes and denied-read outcome', () => {
  for (const subtype of ['breakglass', 'planned', 'false-positive']) {
    const { session, score } = referenceDefense({ ...base, subtype });
    assert.equal(score.success, true, subtype);
    assert.equal(score.verification_success, true, subtype);
    assert.ok(
      session.action_ledger.some(
        (action) =>
          action.tool === (subtype === 'false-positive' ? 'verify-denial' : 'verify-authorization'),
      ),
    );
  }
});
