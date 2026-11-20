import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { solveQuerySchedule } from '../v32/schedule.mjs';
import { buildEpisode } from '../v34/producer.mjs';
import { replayContainment } from '../v34/runtime.mjs';
import { resolvePrefix } from './prefix.mjs';

const wire = (data) => JSON.parse(JSON.stringify(data));
const cases = new Map();

function fixture(seed = 109000, family = FAMILIES[0]) {
  const key = [seed, family].join('/');
  if (!cases.has(key)) {
    const { visible, native } = buildEpisode({ seed, family });
    const index = wire({
      ...listWorkloads(visible),
      query_access_schedule: visible.query_access_schedule,
    });
    const order = solveQuerySchedule(index);
    const tools = { credential: querySource, job: queryWorkload, session: querySession };
    const replies = wire(
      order.map(({ entry_type, entry_id }) => ({
        ok: true,
        evidence: tools[entry_type](visible, entry_id),
      })),
    );
    cases.set(key, { visible, native, index, order, replies });
  }
  return cases.get(key);
}

// This oracle gets the owner from the native register and the approval label from
// native replay; the V20 full-view planner independently checks each such label.
// Whether a prefix can resolve it is determined solely by typed queried IDs.
function oracle({ visible, native }, returned) {
  const actions = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const attempts = replayContainment(native, []).attempt_results;
  assert.equal(attempts.length, 24);
  const expected = {};
  for (const attempt of attempts) {
    const uid = attempt.job_uid;
    const session = native.sessions.find((item) => item.job_uid === uid);
    const submission = visible.events.find(
      (item) => item.kind === 'job-submitted' && item.job_uid === uid,
    );
    const context = visible.events.find((item) => item.event_id === submission.auth_context_ref);
    const active = attempt.kind === 'active';
    const key = active ? 'session:' + session.access_key_ref : 'job:' + uid;
    const dependencies = ['job:' + uid];
    if (context.kind === 'release-token-redeemed') {
      dependencies.push('credential:' + context.credential_id);
    }
    if (active) {
      dependencies.push(key);
    }
    const fullUnsafe = actions.some(({ tool, args }) =>
      active
        ? tool === 'deny-role-session' &&
          args.role_arn === session.role_arn &&
          args.role_session_name === session.role_session_name
        : tool === 'pause-job' && args.job_uid === uid,
    );
    assert.equal(fullUnsafe, !attempt.authorized);
    const hasPolicy = [...returned].some((id) => id.startsWith('session:'));
    const ready = hasPolicy && dependencies.every((id) => returned.has(id));
    expected[key] = {
      status: ready ? (attempt.authorized ? 'approved' : 'unsafe') : 'unresolved',
      dependencies,
    };
  }
  return expected;
}

function recordIds(replies) {
  const ids = new Set();
  for (const { evidence } of replies) {
    for (const [field, id] of Object.entries({
      events: 'event_id',
      membership_audit: 'event_id',
      approval_publications: 'event_id',
      approval_snapshots: 'snapshot_ref',
      grant_snapshots: 'snapshot_ref',
      policy_snapshots: 'snapshot_ref',
      job_queue: 'job_uid',
      session_register: 'access_key_ref',
    })) {
      for (const item of evidence[field] ?? []) {
        ids.add(item[id]);
      }
    }
  }
  return ids;
}

test('empty prefix leaves all 24 indexed current selectors unresolved', () => {
  const { index } = fixture();
  const result = resolvePrefix(index, []);
  assert.equal(Object.keys(result).length, 24);
  assert.ok(
    Object.values(result).every(
      (row) => row.status === 'unresolved' && row.record_ids.length === 0,
    ),
  );
});

test('prefix evidence matches independent native dependencies and full reference on two development pairs in every family', () => {
  for (const seed of [109000, 109001, 109002, 109003]) {
    for (const family of FAMILIES) {
      const item = fixture(seed, family);
      for (const ordinal of [20, 24, 30, 31]) {
        const limit = ordinal - 1;
        const replies = wire(item.replies.slice(0, limit));
        const returned = new Set(
          item.order.slice(0, limit).map((e) => e.entry_type + ':' + e.entry_id),
        );
        const records = recordIds(replies);
        const expected = oracle(item, returned);
        const actual = resolvePrefix(item.index, replies);
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
        for (const [key, row] of Object.entries(actual)) {
          assert.equal(row.status, expected[key].status, [seed, family, ordinal, key].join('/'));
          assert.ok(
            row.record_ids.every((id) => records.has(id)),
            key,
          );
          assert.ok(
            row.dependencies.every((id) => returned.has(id)),
            key,
          );
          if (row.status !== 'unresolved') {
            assert.ok(
              expected[key].dependencies.every((id) => row.dependencies.includes(id)),
              key,
            );
            assert.ok(
              row.dependencies.some((id) => id.startsWith('session:')),
              key,
            );
            assert.ok(row.record_ids.length > 0, key);
          }
        }
        const modified = wire(item.replies);
        for (const reply of modified.slice(limit)) {
          reply.evidence = { events: [{ event_id: 'changed-future' }] };
        }
        assert.equal(
          JSON.stringify(resolvePrefix(item.index, modified.slice(0, limit))),
          JSON.stringify(actual),
        );
      }
    }
  }
});

test('each absent dependency keeps even a known-bad release path unresolved', () => {
  const { index, visible, native, replies, order } = fixture();
  const attempt = replayContainment(native, []).attempt_results.find(
    (item) => item.kind === 'active' && !item.source_approved,
  );
  const session = native.sessions.find((s) => s.job_uid === attempt.job_uid);
  const job = attempt.job_uid;
  const submit = visible.events.find((e) => e.kind === 'job-submitted' && e.job_uid === job);
  const token = visible.events.find((e) => e.event_id === submit.auth_context_ref);
  const keys = [
    'job:' + job,
    'credential:' + token.credential_id,
    'session:' + session.access_key_ref,
  ];
  for (const missing of keys) {
    const subset = replies.filter(
      (_, i) => order[i].entry_type + ':' + order[i].entry_id !== missing,
    );
    assert.equal(resolvePrefix(index, subset)[keys[2]].status, 'unresolved', missing);
  }
  for (const field of [
    'policy_snapshots',
    'approval_snapshots',
    'grant_snapshots',
    'approval_publications',
  ]) {
    const subset = wire(replies);
    for (const { evidence } of subset) {
      delete evidence[field];
    }
    const result = resolvePrefix(index, subset);
    for (const key of [keys[0], keys[2]]) {
      assert.equal(result[key].status, 'unresolved', field);
    }
  }
  for (const kind of [
    'sts-assume-role',
    'sts-assume-web-identity',
    'runtime-credential-request',
    'pod-started',
    'job-admission',
    'controller-reconcile',
    'synced-secret-read',
  ]) {
    const subset = wire(replies);
    for (const { evidence } of subset) {
      evidence.events = evidence.events.filter((event) => event.kind !== kind);
    }
    assert.equal(resolvePrefix(index, subset)[keys[2]].status, 'unresolved', kind);
  }
  assert.equal(resolvePrefix(index, replies)[keys[2]].status, 'unsafe');
});

test('the same Job can have opposite active and renewal approval', () => {
  const item = fixture();
  const attempts = replayContainment(item.native, []).attempt_results;
  const [uid, reads] = [...Map.groupBy(attempts, (r) => r.job_uid)].find(
    ([, pair]) => pair[0].authorized !== pair[1].authorized,
  );
  const session = item.native.sessions.find((s) => s.job_uid === uid);
  const rows = resolvePrefix(item.index, item.replies);
  assert.equal(
    rows['job:' + uid].status,
    reads.find((r) => r.kind === 'renewal').authorized ? 'approved' : 'unsafe',
  );
  assert.notEqual(rows['job:' + uid].status, rows['session:' + session.access_key_ref].status);
});

test('failed and stale proposals do not replace a published grant; group membership precedes the read and grants end exclusively', () => {
  const { index, replies } = fixture();
  const modified = wire(replies);
  const job = modified
    .map((r) => r.evidence)
    .find((e) => e.events?.some((v) => v.kind === 'scheduled-job-authorized'));
  const queued = job.job_queue[0];
  const key = 'job:' + queued.job_uid;
  const plan = queued.renewal_plan;
  const submit = job.events.find((e) => e.kind === 'job-submitted');
  const approvals = resolveCurrentApprovals({ ...job, triage_time: index.triage_time });
  const lanes = approvals.map((a) =>
    job.approval_snapshots.find((s) => s.snapshot_ref === a.snapshot_ref),
  );
  const stale = job.approval_publications.find(
    (p) => p.outcome === 'failed' && p.failure_reason === 'stale-predecessor',
  );
  assert.ok(stale);
  for (const proposal of job.approval_publications.filter((p) => p.outcome === 'failed')) {
    assert.ok(!lanes.some((s) => s.snapshot_ref === proposal.new_snapshot_ref));
    job.approval_snapshots.find((s) => s.snapshot_ref === proposal.new_snapshot_ref).grants = [];
  }
  for (const lane of lanes) {
    lane.grants = [
      {
        grant_id: 'test-grant',
        writer_principal: 'group:test',
        task: { action: plan.action, remote_ref: plan.resource },
        scope: {
          service_account_id: submit.service_account_id,
          template_id: submit.template_id,
          valid_from: plan.planned_at,
          valid_until: plan.planned_at + 1,
        },
      },
    ];
  }
  const status = () => resolvePrefix(index, modified)[key].status;
  assert.equal(status(), 'unsafe');
  job.membership_audit.push({
    event_id: 'test-add',
    audit_stream_ref: lanes[0].audit_stream_ref,
    group_principal: 'group:test',
    member_principal: submit.actor,
    event_time: plan.planned_at - 1,
    arrival_order: 1,
    outcome: 'completed',
    kind: 'group-member-added',
  });
  assert.equal(status(), 'approved');
  lanes[0].grants[0].scope.valid_until = plan.planned_at;
  assert.equal(status(), 'unsafe');
  lanes[0].grants[0].scope.valid_until = plan.planned_at + 1;
  job.membership_audit.at(-1).event_time = plan.planned_at;
  assert.equal(status(), 'unsafe');
});

test('a contradictory duplicate record ID cannot support an authorization verdict', () => {
  const { index, replies } = fixture();
  const reply = wire(replies.find((r) => r.evidence.policy_snapshots));
  reply.evidence.policy_snapshots[0].policy.role_arn = 'contradictory';
  assert.throws(() => resolvePrefix(index, [...replies, reply]), /conflict/i);
});
