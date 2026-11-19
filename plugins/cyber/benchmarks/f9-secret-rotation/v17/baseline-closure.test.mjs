import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefenseSession,
  inferDisposition,
  referenceDefense,
  scoreDefense,
  stepDefense,
} from './defense.mjs';

const base = { seed: 116001, family: 'cached-interval' };
const act = (session, tool, args = {}) => stepDefense(session, { tool, args });

function prepared(subtype) {
  const session = createDefenseSession({ ...base, subtype });
  const judgment = inferDisposition({
    events: act(session, 'events').events,
    authorizations: act(session, 'authorizations').records,
    alert: session.initial.alert,
  });
  const bindings = act(session, 'consumers').bindings.filter(
    (binding) => binding.credential_ref === judgment.credential_ref,
  );
  const verification = judgment.authorization_id
    ? act(session, 'verify-authorization', { ...judgment })
    : act(session, 'verify-denial', { ...judgment });
  assert.equal(verification.verified, true);
  act(session, 'declare', judgment);
  return { session, bindings };
}

test('correct benign declaration without current-version service proof cannot close', () => {
  for (const subtype of ['breakglass', 'false-positive']) {
    const { session, bindings } = prepared(subtype);
    assert.equal(bindings.length, 4);
    act(session, 'finish');
    const score = scoreDefense(session);
    assert.equal(score.triage_success, true);
    assert.equal(score.verification_success, true);
    assert.equal(score.baseline_verified, false);
    assert.equal(score.success, false);
  }
});

test('each bound consumer must pass a non-mutating probe on its current version', () => {
  const incomplete = prepared('breakglass');
  for (const binding of incomplete.bindings.slice(0, -1)) {
    assert.equal(
      act(incomplete.session, 'probe', {
        consumer: binding.consumer_ref,
        version: binding.current_version,
      }).allowed,
      true,
    );
  }
  act(incomplete.session, 'finish');
  assert.equal(scoreDefense(incomplete.session).baseline_verified, false);

  for (const subtype of ['breakglass', 'false-positive']) {
    const { session, bindings } = prepared(subtype);
    for (const binding of bindings) {
      assert.equal(
        act(session, 'probe', { consumer: binding.consumer_ref, version: binding.current_version })
          .allowed,
        true,
      );
    }
    act(session, 'finish');
    const score = scoreDefense(session);
    assert.equal(score.baseline_verified, true);
    assert.equal(score.unnecessary_mutation, false);
    assert.equal(score.success, true);
  }
});

test('visible reference proves benign baseline and still completes recovery', () => {
  for (const subtype of ['malicious', 'breakglass', 'planned', 'false-positive']) {
    const { session, score } = referenceDefense({ ...base, subtype });
    assert.equal(score.success, true, subtype);
    if (['breakglass', 'false-positive'].includes(subtype)) {
      assert.equal(score.baseline_verified, true);
      assert.equal(session.action_ledger.filter((action) => action.tool === 'probe').length, 4);
    }
  }
});
