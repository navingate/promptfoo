import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildEpisode as buildV34Episode } from '../v34/producer.mjs';
import { buildDefenseSession, scoreDefense, stepDefense } from './defense.mjs';

test('an early quarantine is accepted without a verdict and fails at submission', () => {
  const session = buildDefenseSession({ seed: 104000, family: 'reconcile-hook' }, buildV34Episode);
  const cohort_id = session.initial.containment_cohorts.cohorts[0].cohort_id;
  assert.deepEqual(stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id } }), {
    ok: true,
    accepted: true,
    action_count: 1,
  });
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  const score = scoreDefense(session);
  assert.equal(score.success, false);
  assert.equal(score.reason, 'staging-deadline-violation');
  assert.ok(score.staging_deadline_violations > 0);
  assert.deepEqual(
    score.staged_requests.map(({ ordinal }) => ordinal),
    [0],
  );
});

test('a malformed detail call does not advance the query ordinal', () => {
  const session = buildDefenseSession({ seed: 104002, family: 'owner-reference' }, buildV34Episode);
  assert.equal(stepDefense(session, { tool: 'list-workloads', args: {} }).ok, true);
  assert.deepEqual(stepDefense(session, { tool: 'query-source', args: {} }), {
    ok: false,
    reason: 'invalid-args',
  });
  const cohort_id = session.initial.containment_cohorts.cohorts[0].cohort_id;
  assert.equal(stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id } }).ok, true);
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  assert.deepEqual(
    scoreDefense(session).staged_requests.map(({ ordinal }) => ordinal),
    [1],
  );
});
