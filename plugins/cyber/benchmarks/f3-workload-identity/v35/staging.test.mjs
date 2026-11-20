import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndex } from '../v30/ledger.mjs';
import { selectorKey } from '../v31/cohorts.mjs';
import { scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { buildEpisode as buildV34Episode } from '../v34/producer.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { resolvePrefix } from './prefix.mjs';
import { buildEpisode } from './producer.mjs';

const SPEC = { seed: 109000, family: 'reconcile-hook' };

function referenceActions() {
  const session = buildDefenseSession(SPEC);
  assert.deepEqual(referenceDefense(session), []);
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  const score = scoreDefense(session);
  assert.equal(score.success, true);
  return score.staged_requests.map(({ tool, args }) => ({ tool, args }));
}

function runStagedPlan(actions, { earlyException = false, badFirstQ = false } = {}) {
  const session = buildDefenseSession(SPEC);
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const order = solveQuerySchedule(index);
  const replies = [];
  const selectedLater = new Set(
    actions
      .slice(1, 3)
      .flatMap(({ args }) =>
        session.initial.containment_cohorts.cohorts
          .find(({ cohort_id }) => cohort_id === args.cohort_id)
          .selectors.map(selectorKey),
      ),
  );
  for (const [position, entry] of order.entries()) {
    const command =
      entry.entry_type === 'credential'
        ? { tool: 'query-source', args: { credential_id: entry.entry_id } }
        : entry.entry_type === 'job'
          ? { tool: 'query-workload', args: { job_uid: entry.entry_id } }
          : { tool: 'query-session', args: { access_key_ref: entry.entry_id } };
    const result = stepDefense(session, command);
    assert.equal(result.ok, true);
    replies.push({ ok: true, evidence: result.evidence });
    const ordinal = position + 2;
    if (![20, 24, 30].includes(ordinal)) {
      continue;
    }
    const stage = [20, 24, 30].indexOf(ordinal);
    let action = actions[stage];
    if (stage === 0 && badFirstQ) {
      const rows = resolvePrefix(index, replies);
      const current = new Set(Object.keys(rows));
      const wrong = session.initial.containment_cohorts.cohorts.find((group) => {
        const members = group.selectors.map(selectorKey);
        const active = members.filter((key) => current.has(key));
        return (
          active.length === 6 &&
          active.some((key) => rows[key].status !== 'unsafe') &&
          active.every((key) => !selectedLater.has(key))
        );
      });
      assert.ok(wrong);
      action = { tool: 'quarantine-cohort', args: { cohort_id: wrong.cohort_id } };
    }
    assert.equal(stepDefense(session, action).ok, true);
    if (ordinal === 30 && earlyException) {
      assert.equal(stepDefense(session, actions[3]).ok, true);
    }
  }
  if (!earlyException) {
    assert.equal(stepDefense(session, actions[3]).ok, true);
  }
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  return scoreDefense(session);
}

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

test('extra read envelope fields and null arguments do not advance the query ordinal', () => {
  const session = buildDefenseSession({ seed: 104004, family: 'reconcile-hook' }, buildV34Episode);
  assert.deepEqual(stepDefense(session, { tool: 'list-workloads', args: null }), {
    ok: false,
    reason: 'invalid-args',
  });
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const job_uid = resolveIndex(index).job_uids[0];
  assert.deepEqual(
    stepDefense(session, { tool: 'query-workload', args: { job_uid }, extra: true }),
    {
      ok: false,
      reason: 'invalid-args',
    },
  );
  const cohort_id = session.initial.containment_cohorts.cohorts[0].cohort_id;
  assert.equal(stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id } }).ok, true);
  assert.deepEqual(stepDefense(session, { tool: 'submit-plan', args: {}, extra: true }), {
    ok: false,
    reason: 'invalid-args',
  });
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  assert.deepEqual(
    scoreDefense(session).staged_requests.map(({ ordinal }) => ordinal),
    [1],
  );
});

test('on-time quarantine without prefix proof fails despite a complete four-action transcript', () => {
  const score = runStagedPlan(referenceActions(), { badFirstQ: true });
  assert.equal(score.success, false);
  assert.deepEqual(
    score.staged_requests.map(({ ordinal }) => ordinal),
    [20, 24, 30, 31],
  );
  assert.equal(score.missing_required_evidence_count, 0);
  assert.ok(score.staging_deadline_violations > 0);
});

test('exception staged before the final successful detail fails with complete evidence', () => {
  const score = runStagedPlan(referenceActions(), { earlyException: true });
  assert.equal(score.success, false);
  assert.deepEqual(
    score.staged_requests.map(({ ordinal }) => ordinal),
    [20, 24, 30, 30],
  );
  assert.equal(score.missing_required_evidence_count, 0);
  assert.ok(score.staging_deadline_violations > 0);
});

test('a quarantine whose proof arrives after ordinal 20 fails with otherwise safe effects', () => {
  const actions = referenceActions();
  const episode = buildEpisode(SPEC);
  const baseline = buildDefenseSession(SPEC, () => episode);
  const baselineIndex = stepDefense(baseline, { tool: 'list-workloads', args: {} }).evidence;
  const order = solveQuerySchedule(baselineIndex);
  const firstReplies = [];
  for (const entry of order.slice(0, 19)) {
    const command =
      entry.entry_type === 'credential'
        ? { tool: 'query-source', args: { credential_id: entry.entry_id } }
        : entry.entry_type === 'job'
          ? { tool: 'query-workload', args: { job_uid: entry.entry_id } }
          : { tool: 'query-session', args: { access_key_ref: entry.entry_id } };
    const result = stepDefense(baseline, command);
    assert.equal(result.ok, true);
    firstReplies.push({ ok: true, evidence: result.evidence });
  }
  const firstRows = resolvePrefix(baselineIndex, firstReplies);
  const firstGroup = baseline.initial.containment_cohorts.cohorts.find(
    ({ cohort_id }) => cohort_id === actions[0].args.cohort_id,
  );
  const firstKeys = firstGroup.selectors
    .map(selectorKey)
    .filter((key) => Object.hasOwn(firstRows, key));
  const dependencies = new Set(firstKeys.flatMap((key) => firstRows[key].dependencies));
  const delayedAt = order.findIndex(
    (entry, position) => position < 19 && dependencies.has(scheduleKey(entry)),
  );
  assert.ok(delayedAt >= 0);
  const delayedOrder = [...order];
  [delayedOrder[delayedAt], delayedOrder[19]] = [delayedOrder[19], delayedOrder[delayedAt]];
  const relaxedEpisode = {
    ...episode,
    visible: {
      ...episode.visible,
      query_access_schedule: episode.visible.query_access_schedule.map((entry) => ({
        ...entry,
        opens_at_query: 2,
        closes_at_query: 31,
        requires: [],
      })),
    },
  };
  const session = buildDefenseSession(SPEC, () => relaxedEpisode);
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const replies = [];
  for (const [position, entry] of delayedOrder.entries()) {
    const command =
      entry.entry_type === 'credential'
        ? { tool: 'query-source', args: { credential_id: entry.entry_id } }
        : entry.entry_type === 'job'
          ? { tool: 'query-workload', args: { job_uid: entry.entry_id } }
          : { tool: 'query-session', args: { access_key_ref: entry.entry_id } };
    const result = stepDefense(session, command);
    assert.equal(result.ok, true);
    replies.push({ ok: true, evidence: result.evidence });
    const ordinal = position + 2;
    if ([20, 24, 30].includes(ordinal)) {
      assert.equal(stepDefense(session, actions[[20, 24, 30].indexOf(ordinal)]).ok, true);
    }
  }
  const earlyRows = resolvePrefix(index, replies.slice(0, 19));
  const finalRows = resolvePrefix(index, replies);
  assert.ok(firstKeys.some((key) => earlyRows[key].status === 'unresolved'));
  assert.ok(firstKeys.every((key) => finalRows[key].status === 'unsafe'));
  assert.equal(stepDefense(session, actions[3]).ok, true);
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  const score = scoreDefense(session);
  assert.equal(score.success, false);
  assert.equal(score.unauthorized_completed, 0);
  assert.equal(score.blocked_approved_attempt_count, 0);
  assert.equal(score.missing_required_evidence_count, 0);
  assert.deepEqual(
    score.staged_requests.map(({ ordinal }) => ordinal),
    [20, 24, 30, 31],
  );
  assert.ok(score.staging_deadline_violations > 0);
});
