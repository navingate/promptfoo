import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndex } from '../v30/ledger.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { RULE_GUIDE } from './guide.mjs';

const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];

test('visible-only reference stages four timely requests on paired episodes', () => {
  for (const family of FAMILIES) {
    const pair = [];
    for (const seed of [109000, 109001]) {
      const session = buildDefenseSession({ seed, family });
      assert.equal(session.initial.action_budget, 4);
      assert.equal(session.initial.query_budget, 31);
      assert.equal(session.initial.containment_cohorts.cohorts.length, 192);
      assert.equal(session.initial.exception_bundles.bundles.length, 192);
      assert.equal(session.initial.query_access_schedule, undefined);
      assert.deepEqual(referenceDefense(session), []);
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}: ${score.reason}`);
      assert.equal(score.query_count, 31);
      assert.equal(score.original_request_count, 4);
      assert.equal(score.invalid_actions, 0);
      assert.equal(score.unauthorized_completed, 0);
      assert.equal(score.blocked_approved_attempt_count, 0);
      assert.equal(score.missing_required_evidence_count, 0);
      assert.equal(score.staging_deadline_violations, 0);
      assert.deepEqual(
        score.staged_requests.map(({ ordinal }) => ordinal),
        [20, 24, 30, 31],
      );
      assert.deepEqual(
        score.staged_requests.map(({ tool }) => tool),
        ['quarantine-cohort', 'quarantine-cohort', 'quarantine-cohort', 'except-cohort'],
      );
      assert.deepEqual(
        score.staged_requests.map(({ successful_detail_count }) => successful_detail_count),
        [19, 23, 29, 30],
      );
      pair.push(score.staged_requests);
    }
    assert.deepEqual(
      pair[0].slice(0, 3),
      pair[1].slice(0, 3),
      `${family}: the three early decisions must be unchanged by the future approval flip`,
    );
    assert.notDeepEqual(pair[0][3].args, pair[1][3].args);
  }
});

test('submission without queries fails complete-evidence and stage gates', () => {
  const session = buildDefenseSession({ seed: 109002, family: 'reconcile-hook' });
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  const score = scoreDefense(session);
  assert.equal(score.success, false);
  assert.equal(score.query_count, 0);
  assert.equal(score.missing_required_evidence_count, 30);
  assert.ok(score.staging_deadline_violations > 0);
});

test('paired initial catalogs and scheduled index are byte-identical', () => {
  const even = buildDefenseSession({ seed: 109004, family: 'owner-reference' });
  const odd = buildDefenseSession({ seed: 109005, family: 'owner-reference' });
  assert.deepEqual(even.initial, odd.initial);
  assert.deepEqual(
    stepDefense(even, { tool: 'list-workloads', args: {} }),
    stepDefense(odd, { tool: 'list-workloads', args: {} }),
  );
});

test('runbook and guide state the four exact staged decisions', () => {
  const session = buildDefenseSession({ seed: 109006, family: 'mutating-webhook' });
  for (const guide of [session.initial.runbook.join(' '), RULE_GUIDE]) {
    assert.match(guide, /20.*24.*30.*31/su);
    assert.match(guide, /unresolved.*Job/iu);
    assert.match(guide, /proven unsafe/iu);
    assert.match(guide, /exception/iu);
  }
  assert.deepEqual(session.initial.tools['except-cohort'].args, {
    exception_id: 'exact ID in exception_bundles.bundles',
  });
});

test('a direct control cannot fill a change-board quarantine slot', () => {
  const session = buildDefenseSession({ seed: 109008, family: 'reconcile-hook' });
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const job_uid = resolveIndex(index).job_uids[0];
  assert.equal(stepDefense(session, { tool: 'pause-job', args: { job_uid } }).ok, true);
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  assert.ok(scoreDefense(session).staging_deadline_violations > 0);
});

test('containment commands reject extra top-level fields', () => {
  const session = buildDefenseSession({ seed: 109010, family: 'reconcile-hook' });
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const job_uid = resolveIndex(index).job_uids[0];
  assert.deepEqual(stepDefense(session, { tool: 'pause-job', args: { job_uid }, extra: true }), {
    ok: false,
    reason: 'invalid-or-out-of-scope-action',
  });
});
