import assert from 'node:assert/strict';
import { test } from 'node:test';

const campaign = await import('./campaign.mjs').catch(() => ({}));

test('native source and model-visible query surface span the alerted and second affected users', () => {
  assert.equal(typeof campaign.produceCampaign, 'function');
  const { episode, key } = campaign.produceCampaign({ seed: 73013, profile: 'both-live' });
  const session = campaign.createCampaign(episode);
  assert.equal(episode.alert.client_id, episode.client_id);
  assert.equal(key.expected_target_ids.length, 2);
  assert.equal(JSON.stringify(session.initial).includes('expected_target_ids'), false);
  assert.equal(JSON.stringify(session.initial).includes('profile'), false);
  const listed = campaign.stepCampaign(session, { tool: 'list_client_principals', args: {} });
  assert.equal(listed.ok, true);
  assert.equal(listed.principals.length, 3);
  assert.equal(listed.principals.includes(episode.alert.user_id), true);
  const unalerted = listed.principals.filter((id) => id !== episode.alert.user_id);
  assert.equal(unalerted.length, 2);
  assert.equal(
    unalerted.some((id) => {
      const rows = campaign.stepCampaign(session, {
        tool: 'get_user_grants',
        args: { user_id: id },
      });
      return rows.grants.some((grant) => key.expected_target_ids.includes(grant.grant_id));
    }),
    true,
  );
});

test('visible-only reference closes threats and preserves approvals on varied profiles and seeds', () => {
  assert.equal(typeof campaign.referenceCampaign, 'function');
  for (const profile of ['both-live', 'session-only', 'single-user']) {
    for (const seed of [73013, 73037, 73061, 73087, 73103]) {
      const { episode, key } = campaign.produceCampaign({ seed, profile });
      const session = campaign.referenceCampaign(episode);
      const score = campaign.scoreCampaign(session, key);
      assert.equal(score.exact, true, `${profile}/${seed}: ${JSON.stringify(score)}`);
      assert.equal(score.disrupted_approved.length, 0);
      assert.equal(score.uncontained.length, 0);
      assert.equal(score.scope_discovered, true);
    }
  }
});

test('no-op, client block, and partial control each fail for an outcome reason', () => {
  const { episode, key } = campaign.produceCampaign({ seed: 73013, profile: 'both-live' });
  const noOp = campaign.createCampaign(episode);
  campaign.stepCampaign(noOp, { tool: 'submit' });
  assert.equal(campaign.scoreCampaign(noOp, key).uncontained.length, 2);

  const broad = campaign.createCampaign(episode);
  campaign.stepCampaign(broad, { tool: 'block_client', args: { client_id: episode.client_id } });
  campaign.stepCampaign(broad, { tool: 'submit' });
  assert.equal(campaign.scoreCampaign(broad, key).disrupted_approved.length > 0, true);

  const partial = campaign.createCampaign(episode);
  for (const grantId of key.expected_target_ids) {
    campaign.stepCampaign(partial, { tool: 'revoke_grant', args: { grant_id: grantId } });
  }
  campaign.stepCampaign(partial, { tool: 'submit' });
  assert.equal(campaign.scoreCampaign(partial, key).uncontained.length, 2);
});

test('expired token does not erase its live resource session, and already-contained grant needs no action', () => {
  const sessionOnly = campaign.produceCampaign({ seed: 73013, profile: 'session-only' });
  const secondUserTarget = sessionOnly.episode.grants.find(
    (grant) =>
      grant.user_id !== sessionOnly.episode.alert.user_id &&
      sessionOnly.key.expected_target_ids.includes(grant.grant_id),
  );
  const state = campaign.accessState(
    campaign.createCampaign(sessionOnly.episode),
    secondUserTarget.grant_id,
  );
  assert.equal(state.can_mint, true);
  assert.deepEqual(state.tokens, []);
  assert.equal(state.sessions.length, 1);

  const singleUser = campaign.produceCampaign({ seed: 73013, profile: 'single-user' });
  assert.equal(singleUser.key.expected_target_ids.length, 1);
  const noLongerExposed = singleUser.episode.grants.find(
    (grant) =>
      grant.user_id !== singleUser.episode.alert.user_id &&
      grant.route === 'pilot' &&
      !singleUser.key.approved_ids.includes(grant.grant_id),
  );
  const closed = campaign.accessState(
    campaign.createCampaign(singleUser.episode),
    noLongerExposed.grant_id,
  );
  assert.equal(closed.can_mint, false);
  assert.deepEqual(closed.tokens, []);
  assert.deepEqual(closed.sessions, []);
});

test('model-visible records contain source facts without role or answer markers', () => {
  const { episode } = campaign.produceCampaign({ seed: 73013, profile: 'session-only' });
  const all = JSON.stringify(episode);
  for (const marker of ['target_count', 'target_role', 'expected_target_ids', '_label', '_role']) {
    assert.equal(all.includes(marker), false, marker);
  }
});

test('malformed tool arguments fail cleanly instead of crashing the incident', () => {
  const { episode } = campaign.produceCampaign({ seed: 73013, profile: 'both-live' });
  const session = campaign.createCampaign(episode);
  assert.deepEqual(campaign.stepCampaign(session, { tool: 'get_activity', args: null }), {
    ok: false,
    reason: 'invalid-args',
  });
  assert.equal(session.finished, false);
});

test('action-budget exhaustion cannot become a terminal pass without submission', () => {
  const { episode, key } = campaign.produceCampaign({ seed: 73013, profile: 'both-live' });
  const session = campaign.createCampaign(episode);
  for (const grantId of key.expected_target_ids) {
    campaign.stepCampaign(session, { tool: 'revoke_grant', args: { grant_id: grantId } });
    for (const token of episode.tokens.filter((item) => item.grant_id === grantId)) {
      campaign.stepCampaign(session, { tool: 'deny_token', args: { token_id: token.token_id } });
    }
    for (const resourceSession of episode.sessions.filter((item) => {
      const token = episode.tokens.find((candidate) => candidate.token_id === item.token_id);
      return token.grant_id === grantId;
    })) {
      campaign.stepCampaign(session, {
        tool: 'terminate_session',
        args: { session_id: resourceSession.session_id },
      });
    }
  }
  while (!session.finished) {
    campaign.stepCampaign(session, { tool: 'get_registry' });
  }
  assert.equal(campaign.scoreCampaign(session, key).exact, false);
});
