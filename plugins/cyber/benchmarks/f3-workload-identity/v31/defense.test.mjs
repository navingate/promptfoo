import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import {
  buildDefenseSession as buildV30DefenseSession,
  collectDefenseEvidence,
  referenceDefense as referenceV30Defense,
} from '../v30/defense.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';

const spec = (seed, family = 'reconcile-hook') => ({ seed, family });

test('v30 query-only evidence collector preserves the prior reference output', () => {
  const evidence = collectDefenseEvidence(buildV30DefenseSession(spec(96000)));
  assert.equal(evidence.job_queue.length, 12);
  assert.equal(evidence.session_register.length, 12);
  const actions = referenceV30Defense(buildV30DefenseSession(spec(96000)));
  assert.equal(
    createHash('sha256').update(JSON.stringify(actions)).digest('hex'),
    'b09fb0ef495b675a92a61229b6ad6397b2869803f374672e918e4f050f15b331',
  );
});

test('v31 exposes the full paired cohort catalog and no verdict labels', () => {
  const even = buildDefenseSession(spec(98000));
  const odd = buildDefenseSession(spec(98001));
  assert.deepEqual(even.initial.containment_cohorts, odd.initial.containment_cohorts);
  assert.equal(even.initial.action_budget, 7);
  assert.equal(even.initial.query_budget, 31);
  const catalog = even.initial.containment_cohorts;
  assert.equal(catalog.candidates.length, 48);
  assert.equal(catalog.cohorts.length, 96);
  assert.equal(new Set(catalog.cohorts.map(({ cohort_id }) => cohort_id)).size, 96);
  const all = new Set(
    catalog.cohorts.flatMap(({ selectors }) => selectors.map(({ kind, id }) => `${kind}:${id}`)),
  );
  assert.deepEqual(all, new Set(catalog.candidates.map(({ kind, id }) => `${kind}:${id}`)));
  assert.match(JSON.stringify(even.initial), /quarantine-cohort/);
  assert.doesNotMatch(
    JSON.stringify(even.initial),
    /"(?:native|expected|captured|authorized|unauthorized|malicious|tainted|effective_action|threat_closed|function_preserved|attempt_results|future_attempts)"\s*:/u,
  );
});

test('v31 visible reference safely solves three families and both pair members', () => {
  for (const seed of [98000, 98001]) {
    for (const family of FAMILIES) {
      const session = buildDefenseSession(spec(seed, family));
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 7, `${seed}/${family}: ${actions.length}`);
      assert.ok(actions.some(({ tool }) => tool === 'quarantine-cohort'));
      for (const action of actions) {
        assert.equal(stepDefense(session, action).accepted, true);
      }
      assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).finished, true);
      const score = scoreDefense(session);
      assert.equal(score.success, true, `${seed}/${family}: ${JSON.stringify(score)}`);
      assert.equal(score.query_count, 31);
      assert.equal(score.invalid_actions, 0);
      assert.equal(score.unauthorized_completed, 0);
      assert.equal(score.blocked_approved_attempt_count, 0);
    }
  }
});

test('v31 accepts exact cohort and existing controls but rejects malformed or unknown cohorts', () => {
  const session = buildDefenseSession(spec(98000));
  const cohort_id = session.initial.containment_cohorts.cohorts[0].cohort_id;
  const evidence = collectDefenseEvidence(session);
  const job_uid = evidence.job_queue[0].job_uid;
  const { role_arn, role_session_name } = evidence.session_register[0];
  for (const command of [
    { tool: 'quarantine-cohort', args: {} },
    { tool: 'quarantine-cohort', args: { cohort_id, extra: true } },
    { tool: 'quarantine-cohort', args: { cohort_id }, extra: true },
    { tool: 'quarantine-cohort', args: { cohort_id: 42 } },
    { tool: 'quarantine-cohort', args: { cohort_id: 'unknown' } },
  ]) {
    assert.equal(stepDefense(session, command).reason, 'invalid-or-out-of-scope-action');
  }
  for (const command of [
    { tool: 'quarantine-cohort', args: { cohort_id } },
    { tool: 'pause-job', args: { job_uid } },
    { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    { tool: 'revoke-role-sessions', args: { role_arn } },
  ]) {
    assert.equal(stepDefense(session, command).accepted, true);
  }
});

test('an archive detail query consumes the thirty-one-query V31 budget', () => {
  const session = buildDefenseSession(spec(98000));
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const selected = resolveIndex(index);
  const archiveJob = index.job_uids.find((uid) => !selected.job_uids.includes(uid));
  assert.equal(
    stepDefense(session, { tool: 'query-workload', args: { job_uid: archiveJob } }).ok,
    true,
  );
  assert.throws(() => referenceDefense(session), /query-budget-exhausted/u);
});

test('v31 reference rejects a visible catalog without a seven-request cover', () => {
  const session = buildDefenseSession(spec(98000));
  session.initial.containment_cohorts.cohorts = [];
  assert.throws(() => referenceDefense(session), /no safe seven-request containment plan/u);
});

test('a cohort selecting approved current work fails collateral scoring', () => {
  const evidenceSession = buildDefenseSession(spec(98000));
  const visible = collectDefenseEvidence(evidenceSession);
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const unsafeJobs = new Set(
    required.filter(({ tool }) => tool === 'pause-job').map(({ args }) => args.job_uid),
  );
  const unsafeSessions = new Set(
    required
      .filter(({ tool }) => tool === 'deny-role-session')
      .map(
        ({ args }) =>
          visible.session_register.find(
            (session) =>
              session.role_arn === args.role_arn &&
              session.role_session_name === args.role_session_name,
          ).access_key_ref,
      ),
  );
  const currentJobs = new Set(visible.job_queue.map(({ job_uid }) => job_uid));
  const currentSessions = new Set(
    visible.session_register.map(({ access_key_ref }) => access_key_ref),
  );
  const cohort = evidenceSession.initial.containment_cohorts.cohorts.find(({ selectors }) =>
    selectors.some(({ kind, id }) =>
      kind === 'job'
        ? currentJobs.has(id) && !unsafeJobs.has(id)
        : currentSessions.has(id) && !unsafeSessions.has(id),
    ),
  );
  assert.ok(cohort);
  const session = buildDefenseSession(spec(98000));
  assert.equal(
    stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id: cohort.cohort_id } })
      .accepted,
    true,
  );
  stepDefense(session, { tool: 'submit-plan', args: {} });
  const score = scoreDefense(session);
  assert.equal(score.function_preserved, false);
  assert.ok(score.blocked_approved_attempt_count > 0);
});
