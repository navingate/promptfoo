import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV32Episode } from '../v32/producer.mjs';
import { greedyQuerySchedule, scheduleKey, solveQuerySchedule } from '../v32/schedule.mjs';
import { buildDefenseSession, stepDefense } from './defense.mjs';
import { resolvePrefix } from './prefix.mjs';
import { buildPairedSchedule, retimeLastJob, verifyPairedConsole } from './schedule.mjs';

const query = {
  credential: ['query-source', 'credential_id'],
  job: ['query-workload', 'job_uid'],
  session: ['query-session', 'access_key_ref'],
};

function transcript(spec) {
  const session = buildDefenseSession(spec);
  const first = stepDefense(session, { tool: 'list-workloads', args: {} });
  assert.ok(first.ok);
  const index = first.evidence;
  const order = solveQuerySchedule(index);
  const current = resolveIndex(index);
  const expected = [
    ...current.credential_ids.map((id) => 'credential:' + id),
    ...current.job_uids.map((id) => 'job:' + id),
    ...current.access_key_refs.map((id) => 'session:' + id),
  ];
  assert.equal(expected.length, 30);
  assert.deepEqual(order.map(scheduleKey).sort(), expected.sort());
  const replies = [first];
  for (const entry of order) {
    const [tool, field] = query[entry.entry_type];
    const reply = stepDefense(session, { tool, args: { [field]: entry.entry_id } });
    assert.equal(reply.ok, true, tool + ' at ordinal ' + (replies.length + 1));
    replies.push(reply);
  }
  return { initial: session.initial, index, order, replies };
}

test('both real consoles publish their sole differing renewal Job at ordinal 31', () => {
  for (const seed of [109000, 109002]) {
    for (const family of FAMILIES) {
      const even = transcript({ seed, family });
      const odd = transcript({ seed: seed + 1, family });
      assert.equal(JSON.stringify(even.initial), JSON.stringify(odd.initial));
      const differing = even.replies.flatMap((reply, i) =>
        JSON.stringify(reply) === JSON.stringify(odd.replies[i]) ? [] : [i + 1],
      );
      assert.deepEqual(differing, [31], String(seed) + '/' + family);
      const last = even.order.at(-1);
      assert.equal(last.entry_type, 'job');
      const active = even.replies.find(
        (reply) =>
          reply.evidence.session_register?.length === 1 &&
          reply.evidence.events.some(
            (e) => e.kind === 'pod-started' && e.owner_job_uid === last.entry_id,
          ),
      );
      assert.ok(active);
      const activeKey = 'session:' + active.evidence.session_register[0].access_key_ref;
      for (const [variant, expected] of [
        [even, 'approved'],
        [odd, 'unsafe'],
      ]) {
        for (const at of [20, 24, 30, 31]) {
          const prefix = resolvePrefix(variant.index, variant.replies.slice(1, at));
          const keysWith = (status) =>
            Object.keys(prefix).filter((key) => prefix[key].status === status);
          if (at === 20) {
            assert.ok(keysWith('unsafe').length >= 6);
          } else if (at === 24) {
            assert.ok(keysWith('unsafe').length >= 10);
            assert.ok(keysWith('approved').length >= 2);
          } else if (at === 30) {
            assert.equal(keysWith('unsafe').length, 15);
            assert.equal(keysWith('approved').length, 7);
            assert.deepEqual(keysWith('unresolved').sort(), [scheduleKey(last), activeKey].sort());
          } else {
            assert.equal(prefix[scheduleKey(last)].status, expected);
            assert.equal(prefix[activeKey].status, 'approved');
            assert.equal(keysWith('unresolved').length, 0);
          }
        }
      }
    }
  }
});

test('zero or multiple differing workload replies cannot define the final query', () => {
  const spec = { seed: 109000, family: FAMILIES[0] };
  const even = buildV32Episode(spec).visible;
  assert.throws(() => buildPairedSchedule(even, even), /exactly one differing workload reply/u);
  const odd = buildV32Episode({ ...spec, seed: spec.seed + 1 }).visible;
  for (const row of odd.job_queue.slice(0, 2)) {
    row.observation = 'different reply';
  }
  assert.throws(() => buildPairedSchedule(even, odd), /exactly one differing workload reply/u);
});

test('retiming preserves unrelated prerequisites and rejects stale or impossible schedules', () => {
  const spec = { seed: 109000, family: FAMILIES[0] };
  const estate = buildV32Episode(spec);
  const { visible } = estate;
  const index = { ...listWorkloads(visible), query_access_schedule: visible.query_access_schedule };
  const original = solveQuerySchedule(index);
  const job = original.find((row) => row.entry_type === 'job');
  const lastKey = scheduleKey(job);
  const moved = retimeLastJob(index.query_access_schedule, lastKey);
  for (const [i, row] of moved.entries()) {
    assert.deepEqual(
      row.requires,
      index.query_access_schedule[i].requires.filter((r) => scheduleKey(r) !== lastKey),
    );
  }
  const pinned = index.query_access_schedule.map((row) => {
    const ordinal = original.findIndex((r) => scheduleKey(r) === scheduleKey(row)) + 2;
    return ordinal < 2 ? row : { ...row, opens_at_query: ordinal, closes_at_query: ordinal };
  });
  const impossible = retimeLastJob(pinned, lastKey);
  assert.equal(solveQuerySchedule({ ...index, query_access_schedule: impossible }), null);
  const sessions = [0, 1].map(() =>
    buildDefenseSession(spec, () => ({
      ...estate,
      visible: { ...visible, query_access_schedule: impossible },
    })),
  );
  assert.throws(
    () => verifyPairedConsole(sessions, stepDefense, { schedule: impossible, lastJobKey: lastKey }),
    /cannot reach the final renewal Job/u,
  );
  const stale = structuredClone(visible);
  stale.query_access_schedule[0].requires = [{ entry_type: 'job', entry_id: 'absent' }];
  assert.throws(() => buildPairedSchedule(stale, stale), /invalid prerequisite/u);
});

test('the producer proof rejects an extra field in a paired initial console packet', () => {
  assert.throws(
    () => verifyPairedConsole([{ initial: {} }, { initial: { leak: true } }], stepDefense, {}),
    /paired initial console packets differ/u,
  );
});

test('retimed windows preserve the five V32 greedy schedule failures', () => {
  const family = FAMILIES[1];
  const [even, odd] = [109000, 109001].map((seed) => buildV32Episode({ seed, family }).visible);
  const proof = buildPairedSchedule(even, odd);
  const index = { ...listWorkloads(even), query_access_schedule: proof.schedule };
  for (const policy of [
    'index',
    'lexicographic',
    'earliest-deadline',
    'earliest-opening',
    'topological',
  ]) {
    assert.ok(greedyQuerySchedule(index, policy) === null, policy);
  }
});
