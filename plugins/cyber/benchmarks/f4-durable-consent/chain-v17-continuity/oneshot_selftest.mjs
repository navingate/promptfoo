import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceContinuity, referenceContinuity } from './continuity.mjs';
import { parsePlan, renderOneShot, scoreOneShot } from './oneshot.mjs';

test('one-shot prompt exposes source facts and effects without evaluator answers', () => {
  const { episode, key } = produceContinuity({ seed: 85117, profile: 'both-live' });
  const prompt = renderOneShot(episode);
  assert.ok(prompt.includes(episode.alert.alert_id));
  assert.ok(prompt.includes(episode.jobs[0].job_id));
  assert.ok(prompt.includes(episode.run_authorizations[0].authorization_id));
  assert.equal(prompt.includes('expected_target_ids'), false);
  assert.equal(prompt.includes('approved_ids'), false);
  assert.equal(prompt.includes('revocation_delay_ticks'), false);
  assert.equal(prompt.includes('safe_runner'), false);
  assert.equal(prompt.includes(key.expected_target_ids.join(',')), false);
});

test('plan parser accepts only a bounded ordered command array', () => {
  assert.deepEqual(parsePlan('[{"tool":"submit","args":{}}]'), [
    { tool: 'submit', args: {} },
  ]);
  for (const value of ['not json', '{}', '[]', '[{"tool":"submit"}]',
    '[{"tool":"submit","args":null}]',
    '```json\n[{"tool":"submit","args":{}}]\n```']) {
    assert.throws(() => parsePlan(value));
  }
});

test('one-shot runner scores the same visible-only reference plan as the interactive engine', () => {
  const { episode, key } = produceContinuity({ seed: 85117, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const score = scoreOneShot(episode, key, JSON.stringify(plan));
  assert.equal(score.exact, true);
  assert.equal(score.deliveries.every((item) => item.delivered), true);
});

test('a valid JSON action with an invalid target is a scored model failure', () => {
  const { episode, key } = produceContinuity({ seed: 85117, profile: 'both-live' });
  const score = scoreOneShot(
    episode,
    key,
    JSON.stringify([{ tool: 'revoke_grant', args: { grant_id: 'missing' } }, { tool: 'submit', args: {} }]),
  );
  assert.equal(score.exact, false);
  assert.equal(score.invalid_action.reason, 'unknown-grant');
});
