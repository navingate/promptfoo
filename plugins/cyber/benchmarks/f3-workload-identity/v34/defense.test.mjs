import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndex } from '../v30/ledger.mjs';
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
      assert.equal(session.initial.containment_cohorts.cohorts.length, 192);
      assert.equal(session.initial.exception_bundles.bundles.length, 192);
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
  assert.match(text, /overlap.*current|current.*overlap/iu);
  assert.doesNotMatch(text, /cohorts may overlap/iu);
  assert.doesNotMatch(text, /seven|7 containment/u);
  assert.deepEqual(session.initial.tools['except-cohort'].args, {
    exception_id: 'exact ID in exception_bundles.bundles',
  });
  assert.match(RULE_GUIDE, /four containment requests/u);
  assert.match(RULE_GUIDE, /exception removes its selectors from bulk quarantine only/u);
  assert.match(RULE_GUIDE, /thirty current detail records/u);
  assert.match(RULE_GUIDE, /overlap.*current|current.*overlap/iu);
  assert.doesNotMatch(RULE_GUIDE, /cohorts may overlap/iu);
  assert.doesNotMatch(RULE_GUIDE, /seven total requests|seven containment requests/u);
});

test('both paired variants reject missing, wrong, and overlapping quarantine plans at final score', () => {
  const family = FAMILIES[0];
  const plans = [104000, 104001].map((seed) => {
    const session = buildDefenseSession({ seed, family });
    return referenceDefense(session);
  });
  for (const [variant, seed] of [104000, 104001].entries()) {
    const reference = plans[variant];
    const wrongException = plans[1 - variant].find(({ tool }) => tool === 'except-cohort');
    const withoutException = reference.filter(({ tool }) => tool !== 'except-cohort');
    const missingSession = buildDefenseSession({ seed, family });
    referenceDefense(missingSession);
    const missing = submit(missingSession, withoutException);
    assert.equal(missing.success, false);
    assert.equal(missing.original_request_count, 3);

    const wrongSession = buildDefenseSession({ seed, family });
    referenceDefense(wrongSession);
    const wrong = submit(
      wrongSession,
      reference.map((command) => (command.tool === 'except-cohort' ? wrongException : command)),
    );
    assert.equal(wrong.success, false);

    const overlapSession = buildDefenseSession({ seed, family });
    referenceDefense(overlapSession);
    const firstQ = reference.find(({ tool }) => tool === 'quarantine-cohort');
    const firstMembers = overlapSession.initial.containment_cohorts.cohorts.find(
      ({ cohort_id }) => cohort_id === firstQ.args.cohort_id,
    ).selectors;
    const current = new Set(firstMembers.map((selector) => `${selector.kind}:${selector.id}`));
    const otherQ = overlapSession.initial.containment_cohorts.cohorts.find(
      ({ cohort_id, selectors }) =>
        cohort_id !== firstQ.args.cohort_id &&
        selectors.filter((selector) => current.has(`${selector.kind}:${selector.id}`)).length >= 3,
    );
    assert.ok(otherQ);
    const overlap = submit(overlapSession, [
      firstQ,
      { tool: 'quarantine-cohort', args: { cohort_id: otherQ.cohort_id } },
      reference.find(({ tool }) => tool === 'except-cohort'),
    ]);
    assert.equal(overlap.success, false);
    assert.equal(overlap.reason, 'overlapping-current-quarantines');
    assert.ok(overlap.overlapping_current_quarantines > 0);
    assert.ok(
      overlap.rejected_actions.some(({ reason }) => reason === 'overlapping-current-quarantines'),
    );
  }
});

test('all containment commands reject extra top-level fields', () => {
  const session = buildDefenseSession({ seed: 104008, family: 'reconcile-hook' });
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const job_uid = resolveIndex(index).job_uids[0];
  const command = { tool: 'pause-job', args: { job_uid }, extra: 'ignored' };
  assert.deepEqual(stepDefense(session, command), {
    ok: false,
    reason: 'invalid-or-out-of-scope-action',
  });
});
