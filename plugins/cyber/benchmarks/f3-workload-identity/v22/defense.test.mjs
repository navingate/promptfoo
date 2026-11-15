import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { buildEpisode } from '../v21/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const SPEC = { seed: 63000, family: 'reconcile-hook' };

function command(tool, args = {}) {
  return { tool, args };
}

test('v22 exposes indexed evidence without native verdicts or an unfiltered inspect', () => {
  const session = buildDefenseSession(SPEC);
  const index = stepDefense(session, command('list-workloads'));
  assert.equal(index.ok, true);
  assert.equal(index.evidence.job_uids.length, 6);
  assert.equal(index.evidence.credential_ids.length, 5);
  assert.equal(index.evidence.access_key_refs.length, 6);
  const returned = [session.initial, index];
  for (const credential_id of index.evidence.credential_ids) {
    returned.push(stepDefense(session, command('query-source', { credential_id })));
  }
  for (const job_uid of index.evidence.job_uids) {
    returned.push(stepDefense(session, command('query-workload', { job_uid })));
  }
  for (const access_key_ref of index.evidence.access_key_refs) {
    returned.push(stepDefense(session, command('query-session', { access_key_ref })));
  }
  assert.ok(returned.every((item) => item.ok !== false));
  assert.doesNotMatch(
    JSON.stringify(returned),
    /"(?:native|authorized|source_provenance|tainted|attempt_results|threat_closed|function_preserved)"\s*:/u,
  );
  assert.deepEqual(stepDefense(session, command('inspect')), {
    ok: false,
    reason: 'invalid-or-out-of-scope-action',
  });
});

test('v22 known query scopes are exact, complete, and copied from visible evidence', () => {
  const visible = buildEpisode(SPEC).visible;
  const session = buildDefenseSession(SPEC);
  const index = stepDefense(session, command('list-workloads')).evidence;
  const credential_id = index.credential_ids[0];
  const source = stepDefense(session, command('query-source', { credential_id })).evidence;
  assert.ok(source.events.some((event) => event.kind === 'release-token-redeemed'));
  assert.ok(source.events.some((event) => event.kind === 'object-spec-write'));
  assert.ok(source.events.some((event) => event.kind === 'controller-reconcile'));
  assert.ok(source.events.some((event) => event.kind === 'cloud-secret-attempt'));
  for (const event of source.events) {
    assert.deepEqual(
      event,
      visible.events.find((item) => item.event_id === event.event_id),
    );
  }
  const job_uid = index.job_uids[0];
  const workload = stepDefense(session, command('query-workload', { job_uid })).evidence;
  assert.equal(workload.current_job_approvals.length, 2);
  assert.equal(workload.job_queue.length, 1);
  assert.ok(workload.events.some((event) => event.kind === 'job-admission'));
  const access_key_ref = index.access_key_refs[0];
  const cloud = stepDefense(session, command('query-session', { access_key_ref })).evidence;
  assert.equal(cloud.session_register.length, 1);
  assert.ok(cloud.events.some((event) => event.kind === 'sts-assume-role'));
  assert.ok(cloud.events.some((event) => event.kind === 'sts-assume-web-identity'));
  assert.ok(cloud.events.some((event) => event.kind === 'runtime-credential-request'));
});

test('v22 unknown IDs return the same not-found result and bad query syntax is rejected', () => {
  const session = buildDefenseSession(SPEC);
  const missing = { ok: false, reason: 'not-found' };
  assert.deepEqual(
    stepDefense(session, command('query-source', { credential_id: 'nope' })),
    missing,
  );
  assert.deepEqual(stepDefense(session, command('query-workload', { job_uid: 'nope' })), missing);
  assert.deepEqual(
    stepDefense(session, command('query-session', { access_key_ref: 'nope' })),
    missing,
  );
  assert.deepEqual(stepDefense(session, command('query-source', { credential_id: '' })), {
    ok: false,
    reason: 'invalid-args',
  });
  assert.deepEqual(
    stepDefense(session, command('query-source', { credential_id: 'x', extra: 1 })),
    {
      ok: false,
      reason: 'invalid-args',
    },
  );
  assert.equal(scoreDefense(session).reason, 'unsubmitted');
});

test('v22 query-only reference closes the native continuation on all three controller settings', () => {
  for (const seed of [63000, 63001, 63002, 63003]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession({ seed, family });
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 8);
      for (const action of actions) {
        assert.deepEqual(stepDefense(session, action).accepted, true, `${seed}/${family}`);
      }
      assert.equal(stepDefense(session, command('submit-plan')).finished, true);
      assert.equal(scoreDefense(session).success, true, `${seed}/${family}`);
    }
  }
});

test('v22 no-query and broad controls cannot pass a normal case', () => {
  const noQuery = buildDefenseSession(SPEC);
  stepDefense(noQuery, command('submit-plan'));
  assert.equal(scoreDefense(noQuery).success, false);
  const broad = buildDefenseSession(SPEC);
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
