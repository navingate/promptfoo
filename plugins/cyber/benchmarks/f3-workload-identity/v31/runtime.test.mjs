import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { selectorKey, solveCohortCover } from './cohorts.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const episode = () => buildEpisode({ seed: 98000, family: FAMILIES[0] });
const quarantine = (cohort_id) => ({ tool: 'quarantine-cohort', args: { cohort_id } });

function currentActions(visible) {
  return new Map([
    ...visible.job_queue.map(({ job_uid }) => [
      selectorKey({ kind: 'job', id: job_uid }),
      { tool: 'pause-job', args: { job_uid } },
    ]),
    ...visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      selectorKey({ kind: 'session', id: access_key_ref }),
      { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    ]),
  ]);
}

test('native replay expands a safe cohort cover into exact controls', () => {
  const { visible, native } = episode();
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const plan = solveCohortCover(visible.containment_cohorts, currentActions(visible), required);
  const score = replayContainment(native, plan);
  assert.equal(score.success, true);
  assert.equal(score.unauthorized_completed, 0);
  assert.equal(score.blocked_approved_attempt_count, 0);
  assert.equal(score.invalid_actions, 0);
});

test('archive-only selectors have no replay effect', () => {
  const { visible, native } = episode();
  const current = currentActions(visible);
  const archiveOnly = native.containment_cohorts.cohorts.find(({ selectors }) =>
    selectors.every((selector) => !current.has(selectorKey(selector))),
  );
  assert.ok(archiveOnly);
  const baseline = replayContainment(native, []);
  const archived = replayContainment(native, [quarantine(archiveOnly.cohort_id)]);
  assert.deepEqual(archived.attempt_results, baseline.attempt_results);
  assert.equal(archived.invalid_actions, 0);
});

test('a cohort touching an approved current selector blocks approved work', () => {
  const { visible, native } = episode();
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const bad = new Set(
    required.map(({ tool, args }) =>
      tool === 'pause-job'
        ? `job:${args.job_uid}`
        : `session:${
            visible.session_register.find(
              (item) =>
                item.role_arn === args.role_arn &&
                item.role_session_name === args.role_session_name,
            ).access_key_ref
          }`,
    ),
  );
  const unsafe = native.containment_cohorts.cohorts.find(({ selectors }) =>
    selectors.some(
      (selector) =>
        currentActions(visible).has(selectorKey(selector)) && !bad.has(selectorKey(selector)),
    ),
  );
  assert.ok(unsafe);
  const score = replayContainment(native, [quarantine(unsafe.cohort_id)]);
  assert.equal(score.function_preserved, false);
  assert.ok(score.blocked_approved_attempt_count > 0);
});

test('overlapping cohorts deduplicate more than sixteen raw current effects before V24 replay', () => {
  const { native } = episode();
  const current = [
    ...native.jobs.map(({ job_uid }) => ({ kind: 'job', id: job_uid })),
    ...native.sessions.map(({ access_key_ref }) => ({ kind: 'session', id: access_key_ref })),
  ];
  const copy = structuredClone(native);
  copy.containment_cohorts = {
    candidates: current,
    cohorts: Array.from({ length: 7 }, (_, index) => ({
      cohort_id: `test-${index}`,
      selectors: current.slice(index * 3, index * 3 + 4),
    })),
  };
  const score = replayContainment(
    copy,
    copy.containment_cohorts.cohorts.map(({ cohort_id }) => quarantine(cohort_id)),
  );
  assert.equal(score.invalid_actions, 0);
  assert.equal(score.action_log.length, 22);
  assert.ok(score.action_log.every(({ accepted }) => accepted));
});

test('unknown cohorts and malformed requests are rejected and recorded', () => {
  const { native } = episode();
  const known = native.containment_cohorts.cohorts[0].cohort_id;
  const score = replayContainment(native, [
    quarantine('missing'),
    { tool: 'quarantine-cohort', args: { cohort_id: known, extra: true } },
    { tool: 'pause-job', args: { job_uid: native.jobs[0].job_uid, extra: true } },
  ]);
  assert.equal(score.invalid_actions, 3);
  assert.equal(score.rejected_actions.length, 3);
  assert.equal(score.success, false);
  const overBudget = replayContainment(
    native,
    Array.from({ length: 8 }, () => quarantine(known)),
  );
  assert.ok(overBudget.rejected_actions.some(({ reason }) => reason === 'action-budget-exhausted'));
});
