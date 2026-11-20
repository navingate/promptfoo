import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { replayContainment as replayV24Containment } from '../v24/runtime.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import { replayContainment } from './runtime.mjs';

const quarantine = (cohort_id) => ({ tool: 'quarantine-cohort', args: { cohort_id } });
const except = (exception_id) => ({ tool: 'except-cohort', args: { exception_id } });
const pause = (job_uid) => ({ tool: 'pause-job', args: { job_uid } });
const deny = (session) => ({
  tool: 'deny-role-session',
  args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
});
const revoke = (role_arn) => ({ tool: 'revoke-role-sessions', args: { role_arn } });
const job = (id) => ({ kind: 'job', id });
const session = (id) => ({ kind: 'session', id });

let base;
function fixture() {
  base ??= buildV32Episode({ seed: 98000, family: FAMILIES[0] }).native;
  const native = structuredClone(base);
  const [j0, j1] = native.jobs;
  const [s0, s1] = native.sessions;
  const archiveJob = job('archived-job');
  const archiveSession = session('archived-session');
  const candidates = [
    ...native.jobs.map(({ job_uid }) => job(job_uid)),
    ...native.sessions.map(({ access_key_ref }) => session(access_key_ref)),
    archiveJob,
    archiveSession,
  ];
  native.containment_cohorts = {
    candidates,
    cohorts: [
      { cohort_id: 'q0', selectors: [job(j0.job_uid), session(s0.access_key_ref), archiveJob] },
      { cohort_id: 'q1', selectors: [job(j0.job_uid), session(s1.access_key_ref)] },
      { cohort_id: 'qsession', selectors: [session(s0.access_key_ref), archiveSession] },
      { cohort_id: 'archive', selectors: [archiveJob, archiveSession] },
      { cohort_id: 'archive2', selectors: [archiveJob] },
    ],
  };
  native.exception_bundles = {
    candidates,
    bundles: [
      { exception_id: 'e0', selectors: [job(j0.job_uid), archiveSession] },
      { exception_id: 'e1', selectors: [session(s0.access_key_ref), archiveJob] },
    ],
  };
  native.action_budget = 4;
  return { native, j0, j1, s0, s1 };
}

function nativeOutcomes(native, actions) {
  return replayV24Containment({ ...native, action_budget: Math.max(4, actions.length) }, actions)
    .attempt_results;
}

test('bulk exception removes only its matching current selector before native replay', () => {
  const { native, s0 } = fixture();
  const actual = replayContainment(native, [quarantine('q0'), except('e0')]);
  assert.deepEqual(actual.attempt_results, nativeOutcomes(native, [deny(s0)]));
  assert.equal(actual.invalid_actions, 0);
  assert.equal(actual.original_request_count, 2);
});

test('exception cannot undo an explicit pause or issued-session denial', () => {
  const { native, j0, s0 } = fixture();
  const actual = replayContainment(native, [
    quarantine('q0'),
    except('e0'),
    pause(j0.job_uid),
    deny(s0),
  ]);
  assert.deepEqual(actual.attempt_results, nativeOutcomes(native, [pause(j0.job_uid), deny(s0)]));
  assert.equal(actual.action_log.length, 2);
});

test('exception cannot undo a role-wide revocation', () => {
  const { native, s0 } = fixture();
  const actual = replayContainment(native, [quarantine('q0'), except('e0'), revoke(s0.role_arn)]);
  assert.deepEqual(actual.attempt_results, nativeOutcomes(native, [deny(s0), revoke(s0.role_arn)]));
  assert.ok(actual.action_log.some(({ tool }) => tool === 'revoke-role-sessions'));
});

test('the order of staged bulk, exception, and hard controls does not affect outcomes', () => {
  const { native, j0, s0 } = fixture();
  const actions = [quarantine('q0'), except('e0'), quarantine('archive'), pause(j0.job_uid)];
  const expected = nativeOutcomes(native, [pause(j0.job_uid), deny(s0)]);
  for (const order of [
    actions,
    [...actions].reverse(),
    [actions[1], actions[3], actions[0], actions[2]],
  ]) {
    const actual = replayContainment(native, order);
    assert.deepEqual(actual.attempt_results, expected);
    assert.equal(actual.invalid_actions, 0);
  }
});

test('archive-only selectors and an exception-only plan have no native effect', () => {
  const { native } = fixture();
  const baseline = replayContainment(native, []);
  for (const actions of [
    [quarantine('archive')],
    [except('e0')],
    [quarantine('archive'), except('e1')],
  ]) {
    const actual = replayContainment(native, actions);
    assert.deepEqual(actual.attempt_results, baseline.attempt_results);
    assert.equal(actual.action_log.length, 0);
  }
});

test('distinct quarantines sharing a current Job are rejected without changing native effects', () => {
  const { native, j0, s0, s1 } = fixture();
  const actual = replayContainment(native, [quarantine('q0'), quarantine('q1')]);
  assert.deepEqual(
    actual.attempt_results,
    nativeOutcomes(native, [pause(j0.job_uid), deny(s0), deny(s1)]),
  );
  assert.equal(actual.action_log.length, 3);
  assert.equal(actual.overlapping_current_quarantines, 1);
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'overlapping-current-quarantines' },
  ]);
  assert.equal(actual.success, false);
});

test('distinct quarantines sharing a current session are rejected', () => {
  const { native } = fixture();
  const actual = replayContainment(native, [quarantine('q0'), quarantine('qsession')]);
  assert.equal(actual.overlapping_current_quarantines, 1);
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'overlapping-current-quarantines' },
  ]);
  assert.equal(actual.success, false);
});

test('quarantines sharing only archive selectors remain valid when native effects are safe', () => {
  const { native } = fixture();
  native.attempts = [];
  const actual = replayContainment(native, [quarantine('archive'), quarantine('archive2')]);
  assert.equal(actual.success, true);
  assert.equal(actual.overlapping_current_quarantines, 0);
  assert.equal(actual.invalid_actions, 0);
  assert.deepEqual(actual.rejected_actions, []);
});

test('duplicate quarantine ID is rejected even for an archive-only group', () => {
  const { native } = fixture();
  native.attempts = [];
  const actual = replayContainment(native, [quarantine('archive'), quarantine('archive')]);
  assert.equal(actual.overlapping_current_quarantines, 0);
  assert.deepEqual(actual.rejected_actions, [{ index: 1, reason: 'duplicate-quarantine' }]);
  assert.equal(actual.success, false);
});

test('an exception cannot erase a quarantine overlap', () => {
  const { native } = fixture();
  native.attempts = [];
  const actual = replayContainment(native, [quarantine('q0'), quarantine('q1'), except('e0')]);
  assert.equal(actual.overlapping_current_quarantines, 1);
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'overlapping-current-quarantines' },
  ]);
  assert.equal(actual.success, false);
});

test('a direct control may overlap a quarantine', () => {
  const { native, j0 } = fixture();
  native.attempts = [];
  const actual = replayContainment(native, [quarantine('q0'), pause(j0.job_uid)]);
  assert.equal(actual.success, true);
  assert.equal(actual.overlapping_current_quarantines, 0);
  assert.equal(actual.invalid_actions, 0);
});

test('overlap verdict and count do not depend on request order', () => {
  const { native, j0 } = fixture();
  native.attempts = [];
  const actions = [quarantine('q0'), quarantine('q1'), except('e0'), pause(j0.job_uid)];
  for (const order of [
    actions,
    [...actions].reverse(),
    [actions[2], actions[0], actions[3], actions[1]],
  ]) {
    const actual = replayContainment(native, order);
    assert.equal(actual.success, false);
    assert.equal(actual.overlapping_current_quarantines, 1);
    assert.equal(actual.invalid_actions, 1);
    assert.ok(
      actual.rejected_actions.some(({ reason }) => reason === 'overlapping-current-quarantines'),
    );
  }
});

test('unknown, malformed, and second exception requests retain original rejection indices', () => {
  const { native } = fixture();
  const actual = replayContainment(native, [
    quarantine('q0'),
    except('missing'),
    { tool: 'except-cohort', args: { exception_id: 'e0', extra: true } },
    except('e0'),
  ]);
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'unknown-exception' },
    { index: 2, reason: 'invalid-args' },
  ]);
  assert.equal(actual.invalid_actions, 2);
  assert.equal(actual.success, false);

  const second = replayContainment(native, [except('e0'), quarantine('q0'), except('e1')]);
  assert.deepEqual(second.rejected_actions, [{ index: 2, reason: 'exception-budget-exhausted' }]);
  assert.equal(second.success, false);
});

test('four-slot request budget rejects later requests even when earlier ones are duplicates', () => {
  const { native } = fixture();
  const actual = replayContainment(
    native,
    Array.from({ length: 5 }, () => quarantine('q0')),
  );
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'duplicate-quarantine' },
    { index: 2, reason: 'duplicate-quarantine' },
    { index: 3, reason: 'duplicate-quarantine' },
    { index: 4, reason: 'action-budget-exhausted' },
  ]);
  assert.equal(actual.original_request_count, 5);
  assert.equal(actual.success, false);
});

test('direct scope errors and malformed commands are rejected without changing original indices', () => {
  const { native } = fixture();
  const actual = replayContainment(native, [
    quarantine('q0'),
    pause('missing-job'),
    { tool: 'deny-role-session', args: { role_arn: 'unknown', role_session_name: 'unknown' } },
    { tool: 'pause-job', args: { job_uid: native.jobs[0].job_uid, extra: true } },
  ]);
  assert.deepEqual(actual.rejected_actions, [
    { index: 1, reason: 'unknown-job' },
    { index: 2, reason: 'unknown-issued-session' },
    { index: 3, reason: 'invalid-args' },
  ]);
  assert.equal(actual.success, false);
});

test('native outcomes and provenance remain V32 when no V35 requests are made', () => {
  const { native } = fixture();
  const actual = replayContainment(native, []);
  const original = replayV24Containment({ ...native, action_budget: 4 }, []);
  assert.deepEqual(actual.attempt_results, original.attempt_results);
  assert.deepEqual(native.source_provenance, base.source_provenance);
  assert.deepEqual(native.historical_events, base.historical_events);
});

test('invalid catalog membership fails before native replay', () => {
  const { native } = fixture();
  native.exception_bundles.bundles[0].selectors.push(job('not-indexed'));
  assert.throws(() => replayContainment(native, []), /unknown selector/u);
});
