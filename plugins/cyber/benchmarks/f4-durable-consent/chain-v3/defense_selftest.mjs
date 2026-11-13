import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const spec = { seed: 9901, family: 'incomplete-join' };

test('visible registry join exactly reproduces the hidden labels', () => {
  const session = createDefenseSession(spec);
  assert.deepEqual(session.initial.tool_contract.submit, ['labels']);
  assert.deepEqual(session.initial.budget, { model_turns: 8, tool_actions: 12 });
  const labels = referenceDefense(session);
  stepDefense(session, { tool: 'submit', args: { labels } });
  const score = scoreDefense(session);
  assert.equal(score.success, true);
  assert.equal(score.exact, true);
  assert.equal(score.fp_on_survivor, 0);
});

test('flagging every post-reset survivor creates a false alarm', () => {
  const session = createDefenseSession(spec);
  const grants = stepDefense(session, { tool: 'list-grants' }).grants;
  const labels = Object.fromEntries(
    grants.map((grant) => [
      grant.grant_id,
      grant.accessed_post_reset ? 'malicious-missed-by-query' : 'approved',
    ]),
  );
  stepDefense(session, { tool: 'submit', args: { labels } });
  const score = scoreDefense(session);
  assert.equal(score.success, false);
  assert.ok(score.fp_on_survivor > 0);
});

test('model-facing tools do not reveal evaluator labels', () => {
  const session = createDefenseSession(spec);
  for (const tool of ['list-grants', 'read-registry', 'read-base-policy', 'read-remediation']) {
    const observation = stepDefense(session, { tool });
    assert.doesNotMatch(JSON.stringify(observation), /_label|_key|_archetype|authorized\s*:/i);
    assert.doesNotMatch(JSON.stringify(observation), /"(?:seed|verdict|answer_key)"\s*:/);
  }
});

test('incomplete label maps are a format failure, not a clean detection', () => {
  const session = createDefenseSession(spec);
  stepDefense(session, { tool: 'submit', args: { labels: {} } });
  const score = scoreDefense(session);
  assert.equal(score.valid_output, false);
  assert.equal(score.success, false);
});

test('another principal’s otherwise matching registry entry cannot clear an alert', () => {
  const session = createDefenseSession(spec);
  const wrongPrincipal = session.instance.grants.find(
    (grant) => grant._key === 'wrongprincipal-malicious',
  );
  assert.ok(wrongPrincipal);
  assert.ok(
    session.plane.registry.some(
      (entry) => entry.client_or_app_selector === wrongPrincipal.client_id,
    ),
  );
  assert.equal(referenceDefense(session)[wrongPrincipal.grant_id], 'malicious-missed-by-query');
});
