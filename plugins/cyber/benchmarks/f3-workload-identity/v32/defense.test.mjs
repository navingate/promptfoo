import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndex } from '../v30/ledger.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { scheduleKey, solveQuerySchedule } from './schedule.mjs';

const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];

function submit(session, actions) {
  for (const action of actions) {
    assert.equal(stepDefense(session, action).ok, true);
  }
  assert.equal(stepDefense(session, { tool: 'submit-plan', args: {} }).ok, true);
  return scoreDefense(session);
}

function queryDetail(session, entry) {
  const command =
    entry.entry_type === 'credential'
      ? { tool: 'query-source', args: { credential_id: entry.entry_id } }
      : entry.entry_type === 'job'
        ? { tool: 'query-workload', args: { job_uid: entry.entry_id } }
        : { tool: 'query-session', args: { access_key_ref: entry.entry_id } };
  return stepDefense(session, command);
}

test('visible reference passes both pair members in all three settings with exact evidence', () => {
  for (const family of FAMILIES) {
    for (const seed of [100000, 100001]) {
      const session = buildDefenseSession({ seed, family });
      assert.equal(session.initial.query_access_schedule, undefined);
      assert.equal(session.initial.containment_cohorts.cohorts.length, 96);
      const actions = referenceDefense(session);
      assert.ok(actions.length <= 7);
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

test('a correct containment plan submitted with zero queries fails evidence completeness', () => {
  const spec = { seed: 100002, family: 'reconcile-hook' };
  const actions = referenceDefense(buildDefenseSession(spec));
  const session = buildDefenseSession(spec);
  const score = submit(session, actions);
  assert.equal(score.success, false);
  assert.equal(score.reason, 'evidence-incomplete');
  assert.equal(score.query_count, 0);
  assert.equal(score.missing_required_evidence_count, 30);
  assert.equal(score.invalid_actions, 0);
});

test('a mistimed detail query consumes a slot and leaves a correct plan incomplete', () => {
  const spec = { seed: 100004, family: 'mutating-webhook' };
  const actions = referenceDefense(buildDefenseSession(spec));
  const session = buildDefenseSession(spec);
  const first = stepDefense(session, { tool: 'list-workloads', args: {} });
  assert.equal(first.ok, true);
  const index = first.evidence;
  assert.equal(index.query_access_schedule.length, 60);
  const current = resolveIndex(index);
  const selected = new Set([
    ...current.credential_ids.map((entry_id) =>
      scheduleKey({ entry_type: 'credential', entry_id }),
    ),
    ...current.job_uids.map((entry_id) => scheduleKey({ entry_type: 'job', entry_id })),
    ...current.access_key_refs.map((entry_id) => scheduleKey({ entry_type: 'session', entry_id })),
  ]);
  const tooEarly = index.query_access_schedule.find(
    (entry) => selected.has(scheduleKey(entry)) && entry.opens_at_query > 2,
  );
  assert.ok(tooEarly);
  assert.deepEqual(queryDetail(session, tooEarly), { ok: false, reason: 'not-found' });
  const order = solveQuerySchedule(index);
  assert.equal(order.length, 30);
  for (const entry of order.slice(0, 29)) {
    queryDetail(session, entry);
  }
  const score = submit(session, actions);
  assert.equal(score.success, false);
  assert.equal(score.reason, 'evidence-incomplete');
  assert.equal(score.query_count, 31);
  assert.equal(score.invalid_actions, 0);
  assert.ok(score.missing_required_evidence_count >= 1);
});

test('an archive detail query consumes a slot without completing current evidence', () => {
  const spec = { seed: 100006, family: 'owner-reference' };
  const actions = referenceDefense(buildDefenseSession(spec));
  const session = buildDefenseSession(spec);
  const index = stepDefense(session, { tool: 'list-workloads', args: {} }).evidence;
  const current = resolveIndex(index);
  const selected = new Set([
    ...current.credential_ids.map((entry_id) =>
      scheduleKey({ entry_type: 'credential', entry_id }),
    ),
    ...current.job_uids.map((entry_id) => scheduleKey({ entry_type: 'job', entry_id })),
    ...current.access_key_refs.map((entry_id) => scheduleKey({ entry_type: 'session', entry_id })),
  ]);
  const archive = index.query_access_schedule.find((entry) => !selected.has(scheduleKey(entry)));
  assert.ok(archive);
  queryDetail(session, archive);
  const score = submit(session, actions);
  assert.equal(score.success, false);
  assert.equal(score.reason, 'evidence-incomplete');
  assert.equal(score.query_count, 2);
  assert.equal(score.invalid_actions, 0);
  assert.equal(score.missing_required_evidence_count, 30);
});

test('paired consoles expose the same index schedule and cohort catalog', () => {
  const even = buildDefenseSession({ seed: 100008, family: 'reconcile-hook' });
  const odd = buildDefenseSession({ seed: 100009, family: 'reconcile-hook' });
  assert.deepEqual(even.initial.containment_cohorts, odd.initial.containment_cohorts);
  const evenIndex = stepDefense(even, { tool: 'list-workloads', args: {} });
  const oddIndex = stepDefense(odd, { tool: 'list-workloads', args: {} });
  assert.deepEqual(evenIndex, oddIndex);
});
