import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV31Episode } from '../v31/producer.mjs';
import { buildEpisode } from './producer.mjs';
import { greedyQuerySchedule, scheduleKey, solveQuerySchedule } from './schedule.mjs';

const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];
const POLICIES = ['index', 'lexicographic', 'earliest-deadline', 'earliest-opening', 'topological'];

test('V32 preserves V31 native replay and only adds a visible evidence schedule', () => {
  const spec = { seed: 100000, family: 'reconcile-hook' };
  const v31 = buildV31Episode(spec);
  const v32 = buildEpisode(spec);
  assert.deepEqual(v32.native, v31.native);
  const { query_access_schedule, ...visible } = v32.visible;
  assert.deepEqual(visible, v31.visible);
  assert.equal(v32.native.query_access_schedule, undefined);
  assert.equal(query_access_schedule.length, 60);
  assert.ok(
    query_access_schedule.every(
      (entry) =>
        Object.keys(entry).sort().join(',') ===
        'closes_at_query,entry_id,entry_type,opens_at_query,requires',
    ),
  );
});

test('paired variants share the same index, cohorts and schedule but different approvals', () => {
  const even = buildEpisode({ seed: 100002, family: 'mutating-webhook' });
  const odd = buildEpisode({ seed: 100003, family: 'mutating-webhook' });
  assert.deepEqual(listWorkloads(even.visible), listWorkloads(odd.visible));
  assert.deepEqual(even.visible.containment_cohorts, odd.visible.containment_cohorts);
  assert.deepEqual(even.visible.query_access_schedule, odd.visible.query_access_schedule);
  assert.notDeepEqual(even.visible.approval_snapshots, odd.visible.approval_snapshots);
});

test('all three controller settings have thirty scheduled current queries and defeat five greedies', () => {
  for (const family of FAMILIES) {
    const episode = buildEpisode({ seed: 100000, family });
    const index = listWorkloads(episode.visible);
    index.query_access_schedule = episode.visible.query_access_schedule;
    const current = resolveIndex(index);
    const selected = new Set([
      ...current.credential_ids.map((entry_id) =>
        scheduleKey({ entry_type: 'credential', entry_id }),
      ),
      ...current.job_uids.map((entry_id) => scheduleKey({ entry_type: 'job', entry_id })),
      ...current.access_key_refs.map((entry_id) =>
        scheduleKey({ entry_type: 'session', entry_id }),
      ),
    ]);
    assert.equal(selected.size, 30);
    const plan = solveQuerySchedule(index);
    assert.equal(plan.length, 30);
    assert.deepEqual(new Set(plan.map(scheduleKey)), selected);
    for (const policy of POLICIES) {
      assert.equal(greedyQuerySchedule(index, policy), null, `${family}: ${policy}`);
    }
  }
});
