import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildQuerySchedule,
  canQueryDetail,
  greedyQuerySchedule,
  scheduleKey,
  solveQuerySchedule,
} from './schedule.mjs';

const TYPES = [
  ['credential', 6],
  ['job', 12],
  ['session', 12],
];

function fixtureIndex() {
  const entries = [];
  const snapshots = [];
  const ids = { credential_ids: [], job_uids: [], access_key_refs: [] };
  for (const [type, count] of TYPES) {
    const collection =
      type === 'credential' ? 'credential_ids' : type === 'job' ? 'job_uids' : 'access_key_refs';
    for (let index = 0; index < count * 2; index += 1) {
      const id = `${type}-${String(index).padStart(2, '0')}`;
      const ref = `snapshot-${type}-${index}`;
      ids[collection].push(id);
      entries.push({ entry_type: type, entry_id: id, base_snapshot_ref: ref });
      snapshots.push({
        snapshot_ref: ref,
        entry_type: type,
        entry_id: id,
        planned_at: index < count ? 100 : 200,
      });
    }
  }
  return {
    triage_time: 90,
    horizon_end: 150,
    ...ids,
    evidence_index: { entries, snapshots, publications: [] },
  };
}

function key(row) {
  return scheduleKey(row);
}

function trapIndex() {
  const index = fixtureIndex();
  const current = index.evidence_index.entries.filter((entry) => {
    const limit = TYPES.find(([type]) => type === entry.entry_type)[1];
    return Number(entry.entry_id.slice(-2)) < limit;
  });
  const [a, b, c] = current;
  index.query_access_schedule = index.evidence_index.entries.map((entry) => {
    const position = current.findIndex((item) => key(item) === key(entry));
    const slot = position + 2;
    return {
      entry_type: entry.entry_type,
      entry_id: entry.entry_id,
      opens_at_query: position < 0 ? 2 : slot,
      closes_at_query: position < 0 ? 31 : slot,
      requires: [],
    };
  });
  const byKey = new Map(index.query_access_schedule.map((entry) => [key(entry), entry]));
  Object.assign(byKey.get(key(a)), { opens_at_query: 2, closes_at_query: 4 });
  Object.assign(byKey.get(key(b)), { opens_at_query: 2, closes_at_query: 4 });
  Object.assign(byKey.get(key(c)), {
    opens_at_query: 3,
    closes_at_query: 3,
    requires: [{ entry_type: b.entry_type, entry_id: b.entry_id }],
  });
  return { index, a, b, c };
}

test('typed keys reject malformed selectors', () => {
  assert.equal(scheduleKey({ entry_type: 'job', entry_id: 'j-1' }), 'job:j-1');
  assert.throws(() => scheduleKey({ entry_type: 'pod', entry_id: 'p-1' }));
  assert.throws(() => scheduleKey({ entry_type: 'job', entry_id: '' }));
});

test('visible-only search finds a feasible order that simple greedies miss', () => {
  const { index, a, b, c } = trapIndex();
  const order = solveQuerySchedule(index);
  assert.equal(order.length, 30);
  assert.deepEqual(order.slice(0, 3).map(key), [b, c, a].map(key));
  for (const policy of [
    'index',
    'lexicographic',
    'earliest-deadline',
    'earliest-opening',
    'topological',
  ]) {
    assert.equal(greedyQuerySchedule(index, policy), null, policy);
  }
});

test('a valid but impossible window returns no schedule', () => {
  const { index, b } = trapIndex();
  const entry = index.query_access_schedule.find((item) => key(item) === key(b));
  entry.opens_at_query = 31;
  entry.closes_at_query = 31;
  assert.equal(solveQuerySchedule(index), null);
});

test('index-order baseline uses the triage index rather than shuffled schedule rows', () => {
  const index = fixtureIndex();
  index.query_access_schedule = index.evidence_index.entries
    .map(({ entry_type, entry_id }) => ({
      entry_type,
      entry_id,
      opens_at_query: 2,
      closes_at_query: 31,
      requires: [],
    }))
    .reverse();
  assert.equal(greedyQuerySchedule(index, 'index')[0].entry_id, 'credential-00');
});

test('catalog validation catches duplicates, missing IDs, and current-to-archive prerequisites', () => {
  const { index } = trapIndex();
  const duplicate = structuredClone(index);
  duplicate.query_access_schedule[1] = structuredClone(duplicate.query_access_schedule[0]);
  assert.throws(() => solveQuerySchedule(duplicate), /duplicate|missing/u);

  const missing = structuredClone(index);
  missing.query_access_schedule.pop();
  assert.throws(() => solveQuerySchedule(missing), /sixty|missing/u);

  const archive = structuredClone(index);
  const current = archive.query_access_schedule.find((entry) => entry.entry_id === 'job-00');
  current.requires = [{ entry_type: 'job', entry_id: 'job-12' }];
  assert.throws(() => solveQuerySchedule(archive), /archive/u);
});

test('generator is deterministic, pair stable, covers sixty IDs, and hides the planted order', () => {
  const first = fixtureIndex();
  const second = fixtureIndex();
  const left = buildQuerySchedule(first, { pairSeed: 100000, family: 'reconcile-hook', nonce: 3 });
  const right = buildQuerySchedule(second, {
    pairSeed: 100000,
    family: 'reconcile-hook',
    nonce: 3,
  });
  assert.deepEqual(left, right);
  assert.equal(left.length, 60);
  assert.equal(new Set(left.map(key)).size, 60);
  assert.ok(
    left.every(
      (entry) =>
        Object.keys(entry).sort().join(',') ===
        'closes_at_query,entry_id,entry_type,opens_at_query,requires',
    ),
  );
  first.query_access_schedule = left;
  const order = solveQuerySchedule(first);
  assert.equal(order.length, 30);
  const complete = new Set();
  for (const [index, entry] of order.entries()) {
    assert.equal(canQueryDetail(left, entry.entry_type, entry.entry_id, index + 2, complete), true);
    complete.add(key(entry));
  }
  assert.notDeepEqual(
    left,
    buildQuerySchedule(second, { pairSeed: 100000, family: 'reconcile-hook', nonce: 4 }),
  );
});

test('generator plants a feasible precedence trap that defeats earliest deadline first', () => {
  const index = fixtureIndex();
  for (let nonce = 0; nonce < 16; nonce += 1) {
    index.query_access_schedule = buildQuerySchedule(index, {
      pairSeed: 100000,
      family: 'reconcile-hook',
      nonce,
    });
    assert.ok(solveQuerySchedule(index), `nonce ${nonce} has a feasible order`);
    assert.equal(greedyQuerySchedule(index, 'earliest-deadline'), null, `nonce ${nonce}`);
  }
});

test('a premature or expired query and an unmet prerequisite reveal no detail', () => {
  const { index, b, c } = trapIndex();
  const complete = new Set();
  assert.equal(
    canQueryDetail(index.query_access_schedule, c.entry_type, c.entry_id, 2, complete),
    false,
  );
  assert.equal(
    canQueryDetail(index.query_access_schedule, c.entry_type, c.entry_id, 3, complete),
    false,
  );
  complete.add(key(b));
  assert.equal(
    canQueryDetail(index.query_access_schedule, c.entry_type, c.entry_id, 3, complete),
    true,
  );
  assert.equal(
    canQueryDetail(index.query_access_schedule, c.entry_type, c.entry_id, 4, complete),
    false,
  );
});
