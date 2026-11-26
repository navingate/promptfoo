import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { referenceDefense as legacyScopedReference } from '../v22/defense.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const SPECS = FAMILIES.flatMap((family) =>
  Array.from({ length: 12 }, (_, offset) => ({ seed: 111000 + offset, family })),
);

function command(session, tool, args = {}) {
  const result = stepDefense(session, { tool, args });
  assert.equal(result.ok, true, `${tool}: ${result.reason}`);
  return result.evidence;
}

function run(spec, plan) {
  const session = buildDefenseSession(spec);
  const actions = plan(session);
  for (const action of actions) {
    command(session, action.tool, action.args);
  }
  command(session, 'submit-plan');
  return scoreDefense(session);
}

function broad(session) {
  const index = command(session, 'list-workloads');
  const rollout = index.incident_events.find(
    (event) => event.kind === 'workload-identity-cutover-status',
  );
  return [{ tool: 'revoke-role-sessions', args: { role_arn: rollout.old_role_arn } }];
}

function blanketScoped(session) {
  const index = command(session, 'list-workloads');
  const actions = index.job_uids.map((job_uid) => ({ tool: 'pause-job', args: { job_uid } }));
  for (const access_key_ref of index.access_key_refs) {
    const details = command(session, 'query-session', { access_key_ref });
    const issued = details.session_register[0];
    if (issued.liveness === 'live') {
      actions.push({
        tool: 'deny-role-session',
        args: { role_arn: issued.role_arn, role_session_name: issued.role_session_name },
      });
    }
  }
  return actions;
}

test('matched pairs preserve their source, Job, Pod and STS history', () => {
  for (const family of FAMILIES) {
    for (let seed = 111000; seed < 111012; seed += 2) {
      const ready = buildEpisode({ seed, family });
      const serving = buildEpisode({ seed: seed + 1, family });
      assert.deepEqual(ready.native.historical_events, serving.native.historical_events);
      assert.deepEqual(ready.native.jobs, serving.native.jobs);
      assert.deepEqual(ready.native.sessions, serving.native.sessions);
      assert.deepEqual(ready.native.attempts, serving.native.attempts);
    }
  }
});

test('visible-only reference preserves all service outcomes', () => {
  for (const spec of SPECS) {
    const score = run(spec, referenceDefense);
    assert.equal(score.success, true, JSON.stringify({ spec, score }));
    assert.equal(score.unauthorized_completed, 0);
    assert.equal(score.blocked_approved_attempt_count, 0);
    assert.equal(score.recoverable_function, true);
    assert.equal(score.invalid_actions, 0);
  }
});

test('ordinary shortcuts have observable failures', () => {
  const policies = {
    no_action: () => [],
    broad_everywhere: broad,
    blanket_scoped: blanketScoped,
    old_scoped_reference: legacyScopedReference,
    broad_on_committed_route: (session) => {
      const index = command(session, 'list-workloads');
      const rollout = index.incident_events.find(
        (event) => event.kind === 'workload-identity-cutover-status',
      );
      return rollout.approved_traffic_route === 'replacement' ? broad(session) : [];
    },
  };
  const results = {};
  for (const [name, policy] of Object.entries(policies)) {
    results[name] = SPECS.filter((spec) => run(spec, policy).success).length;
    assert.ok(results[name] < SPECS.length, `${name} solved all cases`);
  }
  assert.deepEqual(results, {
    no_action: 3,
    broad_everywhere: 9,
    blanket_scoped: 0,
    old_scoped_reference: 27,
    broad_on_committed_route: 12,
  });
});

test('future reissue must have a native Job, Pod, STS and read chain', () => {
  const episode = buildEpisode({ seed: 111000, family: FAMILIES[0] });
  episode.native.reissue.future_events[3].causal_ref = 'different-session';
  assert.throws(() => replayContainment(episode.native, []), /future Job\/Pod\/STS\/read chain/);
});
