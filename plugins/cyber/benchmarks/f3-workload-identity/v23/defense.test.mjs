import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { projectVisible } from '../v20/producer.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildNativeEpisode } from '../v21/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

function command(tool, args = {}) {
  return { tool, args };
}

test('v23 query exposes both approval journals and no effective snapshot', () => {
  const session = buildDefenseSession({ seed: 70000, family: FAMILIES[0] });
  const index = stepDefense(session, command('list-workloads')).evidence;
  const workload = stepDefense(
    session,
    command('query-workload', { job_uid: index.job_uids[0] }),
  ).evidence;
  assert.equal(Object.hasOwn(workload, 'current_job_approvals'), false);
  assert.ok(workload.approval_snapshots.length >= 2);
  assert.ok(workload.approval_publications.length >= 2);
  assert.ok(workload.approval_publications.some((item) => item.outcome === 'failed'));
  assert.doesNotMatch(
    JSON.stringify([session.initial, workload]),
    /"(?:native|authorized|source_provenance|attempt_results)"\s*:/u,
  );
});

test('v23 query-only reference preserves approved work and stops unauthorized reads', () => {
  for (const seed of [70000, 70001, 70002, 70003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 8, `${seed}/${family}`);
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true, `${seed}/${family}`);
      }
      assert.equal(stepDefense(session, command('submit-plan')).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}`);
      assert.ok(score.query_count <= 32);
    }
  }
});

test('v23 journal reference agrees with the same native cohort projected directly', () => {
  const family = FAMILIES[0];
  const seen = [];
  for (const seed of [70000, 70001]) {
    const spec = { seed, family };
    const v23 = buildDefenseSession(spec);
    const projectedView = projectVisible(
      buildNativeEpisode(spec, { requirePersistentJobDenial: true }),
      { minJobs: 5, maxJobs: 6 },
    );
    const v23Actions = referenceDefense(v23);
    // Native outcome authority is unchanged; the reference action set must
    // agree with the earlier projected view for each member of the pair.
    assert.deepEqual(v23Actions, planReferenceContainment(projectedView));
    seen.push(JSON.stringify(v23Actions));
  }
  assert.notEqual(seen[0], seen[1]);
});

test('v23 no-query and blanket role revocation fail on a normal case', () => {
  const spec = { seed: 70000, family: FAMILIES[0] };
  const noQuery = buildDefenseSession(spec);
  stepDefense(noQuery, command('submit-plan'));
  assert.equal(scoreDefense(noQuery).success, false);
  const broad = buildDefenseSession(spec);
  const index = stepDefense(broad, command('list-workloads')).evidence;
  const role = stepDefense(
    broad,
    command('query-session', { access_key_ref: index.access_key_refs[0] }),
  ).evidence.session_register[0].role_arn;
  assert.equal(
    stepDefense(broad, command('revoke-role-sessions', { role_arn: role })).accepted,
    true,
  );
  stepDefense(broad, command('submit-plan'));
  assert.equal(scoreDefense(broad).function_preserved, false);
});
