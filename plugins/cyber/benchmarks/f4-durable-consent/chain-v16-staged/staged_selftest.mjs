import assert from 'node:assert/strict';
import { test } from 'node:test';

const staged = await import('./staged.mjs').catch(() => ({}));

function step(session, tool, args = {}) {
  const result = staged.stepStaged(session, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${result.reason}`);
  return result;
}

test('visible-only reference contains and restores every profile across seeds', () => {
  assert.equal(typeof staged.produceStaged, 'function');
  assert.equal(typeof staged.referenceStaged, 'function');
  for (const profile of ['both-live', 'session-only', 'single-user']) {
    for (const seed of [73013, 73037, 73061, 73087, 73103]) {
      const { episode, key } = staged.produceStaged({ seed, profile });
      const session = staged.referenceStaged(episode);
      const score = staged.scoreStaged(session, key);
      assert.equal(score.exact, true, `${profile}/${seed}: ${JSON.stringify(score)}`);
      assert.equal(score.unauthorized_calls.length, 0);
      assert.equal(score.uncontained.length, 0);
      assert.equal(score.disrupted_approved.length, 0);
      assert.equal(score.unnecessary_quarantines.length, 0);
      assert.equal(score.scope_discovered, true);
    }
  }
});

test('acknowledged grant revocation is not effective closure before propagation', () => {
  const { episode, key } = staged.produceStaged({ seed: 73013, profile: 'both-live' });
  const session = staged.createStaged(episode);
  for (const id of key.expected_target_ids) {
    const ack = step(session, 'revoke_grant', { grant_id: id });
    assert.equal(ack.accepted, true);
  }
  const audit = step(session, 'get_audit');
  assert.equal(
    audit.events.some((event) => event.kind === 'revocation-requested'),
    true,
  );
  const first = step(session, 'advance');
  assert.equal(first.protected_calls.length > 0, true);
  for (const call of first.protected_calls) {
    assert.equal(
      episode.grants.some((grant) => call.call_id.includes(grant.grant_id.slice(-8))),
      false,
      'a response call ID must not encode its grant',
    );
  }
  step(session, 'submit');
  const score = staged.scoreStaged(session, key);
  assert.equal(score.exact, false);
  assert.equal(score.unauthorized_calls.length > 0, true);
});

test('early release, session persistence, and broad client block fail distinct outcomes', () => {
  const { episode, key } = staged.produceStaged({ seed: 73037, profile: 'session-only' });
  const targetGrants = episode.grants.filter((grant) =>
    key.expected_target_ids.includes(grant.grant_id),
  );

  const noOp = staged.createStaged(episode);
  step(noOp, 'submit');
  assert.equal(staged.scoreStaged(noOp, key).unauthorized_calls.length > 0, true);

  const early = staged.createStaged(episode);
  for (const grant of targetGrants) {
    step(early, 'set_quarantine', { user_id: grant.user_id, on: true });
    step(early, 'revoke_grant', { grant_id: grant.grant_id });
  }
  step(early, 'advance');
  for (const grant of targetGrants) {
    step(early, 'set_quarantine', { user_id: grant.user_id, on: false });
  }
  step(early, 'advance');
  step(early, 'submit');
  assert.equal(staged.scoreStaged(early, key).unauthorized_calls.length > 0, true);

  const persistentSession = staged.createStaged(episode);
  for (const grant of targetGrants) {
    step(persistentSession, 'set_quarantine', { user_id: grant.user_id, on: true });
    step(persistentSession, 'revoke_grant', { grant_id: grant.grant_id });
  }
  for (let tick = 0; tick < 3; tick += 1) {
    step(persistentSession, 'advance');
  }
  for (const grant of targetGrants) {
    step(persistentSession, 'set_quarantine', { user_id: grant.user_id, on: false });
  }
  step(persistentSession, 'advance');
  step(persistentSession, 'submit');
  assert.equal(staged.scoreStaged(persistentSession, key).unauthorized_calls.length > 0, true);

  const broad = staged.createStaged(episode);
  step(broad, 'block_client');
  step(broad, 'submit');
  assert.equal(staged.scoreStaged(broad, key).disrupted_approved.length > 0, true);

  const sessionOnly = targetGrants.find((grant) =>
    episode.tokens.some(
      (token) => token.grant_id === grant.grant_id && token.expires_at <= episode.now,
    ),
  );
  const live = staged.accessState(staged.createStaged(episode), sessionOnly.grant_id);
  assert.deepEqual(live.tokens, []);
  assert.equal(live.sessions.length, 1);
});

test('terminal submission and model-visible source boundary are enforced', () => {
  const { episode, key } = staged.produceStaged({ seed: 73061, profile: 'both-live' });
  const session = staged.createStaged(episode);
  assert.equal(JSON.stringify(session.initial).includes('expected_target_ids'), false);
  assert.equal(JSON.stringify(session.initial).includes('profile'), false);
  assert.deepEqual(staged.stepStaged(session, { tool: 'get_activity', args: null }), {
    ok: false,
    reason: 'invalid-args',
  });
  assert.equal(staged.scoreStaged(session, key).exact, false);
  step(session, 'submit');
  assert.equal(staged.scoreStaged(session, key).exact, false);
});

test('source token, session, call, and alert lineage remains causally valid', () => {
  for (const profile of ['both-live', 'session-only', 'single-user']) {
    for (const seed of [73013, 73037, 73061, 73087, 73103]) {
      const { episode } = staged.produceStaged({ seed, profile });
      const tokenById = new Map(episode.tokens.map((token) => [token.token_id, token]));
      const sessionById = new Map(episode.sessions.map((session) => [session.session_id, session]));
      assert.equal(new Set(episode.calls.map((call) => call.call_id)).size, episode.calls.length);
      for (const resourceSession of episode.sessions) {
        const token = tokenById.get(resourceSession.token_id);
        assert.ok(token);
        assert.equal(token.user_id, resourceSession.user_id);
        assert.equal(token.issued_at <= resourceSession.created_at, true);
        assert.equal(resourceSession.created_at < resourceSession.expires_at, true);
      }
      for (const call of episode.calls) {
        const resourceSession = sessionById.get(call.session_id);
        assert.ok(resourceSession);
        assert.equal(resourceSession.user_id, call.user_id);
        assert.equal(resourceSession.created_at < call.time, true);
        assert.equal(call.time < resourceSession.expires_at, true);
      }
      const alertCall = episode.calls.find(
        (call) => call.call_id === episode.alert.protected_call_id,
      );
      assert.ok(alertCall);
      assert.equal(alertCall.user_id, episode.alert.user_id);
      assert.equal(alertCall.client_id, episode.alert.client_id);
    }
  }
});
