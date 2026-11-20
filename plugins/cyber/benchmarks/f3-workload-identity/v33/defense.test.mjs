import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { RULE_GUIDE } from './guide.mjs';

const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];

function submit(session, actions) {
  for (const action of actions) {
    assert.equal(stepDefense(session, action).ok, true);
  }
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  return scoreDefense(session);
}

test('visible-only reference passes paired episodes with complete scheduled evidence', () => {
  for (const family of FAMILIES) {
    for (const seed of [104000, 104001]) {
      const session = buildDefenseSession({ seed, family });
      assert.equal(session.initial.action_budget, 4);
      assert.equal(session.initial.query_budget, 31);
      assert.equal(session.initial.containment_cohorts.cohorts.length, 96);
      assert.equal(session.initial.exception_bundles.bundles.length, 96);
      assert.equal(session.initial.query_access_schedule, undefined);
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 4);
      assert.ok(actions.some((action) => action.tool === 'except-cohort'));
      const score = submit(session, actions);
      assert.equal(score.success, true, `${seed}/${family}: ${score.reason}`);
      assert.equal(score.query_count, 31);
      assert.equal(score.invalid_actions, 0);
      assert.equal(score.unauthorized_completed, 0);
      assert.equal(score.blocked_approved_attempt_count, 0);
      assert.equal(score.missing_required_evidence_count, 0);
    }
  }
});

test('a correct four-request plan fails without all thirty detail replies', () => {
  const spec = { seed: 104002, family: 'reconcile-hook' };
  const actions = referenceDefense(buildDefenseSession(spec));
  const score = submit(buildDefenseSession(spec), actions);
  assert.equal(score.success, false);
  assert.equal(score.reason, 'evidence-incomplete');
  assert.equal(score.query_count, 0);
  assert.equal(score.missing_required_evidence_count, 30);
});

test('paired initial catalogs and scheduled index are identical', () => {
  const even = buildDefenseSession({ seed: 104004, family: 'owner-reference' });
  const odd = buildDefenseSession({ seed: 104005, family: 'owner-reference' });
  assert.deepEqual(even.initial.containment_cohorts, odd.initial.containment_cohorts);
  assert.deepEqual(even.initial.exception_bundles, odd.initial.exception_bundles);
  const evenIndex = stepDefense(even, { tool: 'list-workloads', args: {} });
  const oddIndex = stepDefense(odd, { tool: 'list-workloads', args: {} });
  assert.deepEqual(evenIndex, oddIndex);
});

test('the initial runbook and guide state the coupled four-request semantics', () => {
  const session = buildDefenseSession({ seed: 104006, family: 'mutating-webhook' });
  const text = session.initial.runbook.join(' ');
  assert.match(text, /four|4/u);
  assert.match(text, /except-cohort/u);
  assert.doesNotMatch(text, /seven|7 containment/u);
  assert.deepEqual(session.initial.tools['except-cohort'].args, {
    exception_id: 'exact ID in exception_bundles.bundles',
  });
  assert.match(RULE_GUIDE, /four containment requests/u);
  assert.match(RULE_GUIDE, /exception removes its selectors from bulk quarantine only/u);
  assert.match(RULE_GUIDE, /thirty current detail records/u);
  assert.doesNotMatch(RULE_GUIDE, /seven total requests|seven containment requests/u);
});
