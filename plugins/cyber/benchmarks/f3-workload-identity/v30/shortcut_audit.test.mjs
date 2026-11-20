import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { replayContainment } from '../v24/runtime.mjs';
import { resolveIndex } from './ledger.mjs';
import { buildEpisode } from './producer.mjs';
import { listWorkloads } from './queries.mjs';

function assertShortcutFails(label, heuristic, selected, allIds) {
  assert.ok(
    allIds.some((id) => heuristic.has(id) !== selected.has(id)),
    `${label} exactly selects current evidence`,
  );
  assert.ok(
    allIds.some((id) => heuristic.has(id) === selected.has(id)),
    `${label} complement exactly selects current evidence`,
  );
}

test('v30 snapshot-name, position, and first-publication shortcuts fail in both directions', () => {
  for (let seed = 96000; seed < 96012; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      const index = listWorkloads(visible);
      const current = resolveIndex(index);
      const snapshots = new Map(
        index.evidence_index.snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]),
      );
      const base = new Set(
        index.evidence_index.entries
          .filter((entry) => snapshots.get(entry.base_snapshot_ref)?.planned_at < index.horizon_end)
          .map((entry) => entry.entry_id),
      );
      const proposed = new Set(
        index.evidence_index.publications
          .filter((publication) => publication.outcome === 'failed')
          .filter(
            (publication) =>
              snapshots.get(publication.new_snapshot_ref)?.planned_at < index.horizon_end,
          )
          .map((publication) => publication.entry_id),
      );
      const selected = new Set([
        ...current.credential_ids,
        ...current.job_uids,
        ...current.access_key_refs,
      ]);
      assert.equal(selected.size, 30);
      const allIds = index.evidence_index.entries.map((entry) => entry.entry_id);
      assertShortcutFails('base snapshot', base, selected, allIds);
      assertShortcutFails('failed proposal', proposed, selected, allIds);
      assert.ok(
        index.evidence_index.snapshots.every((snapshot) =>
          /^indexsnap-[a-f0-9]{24}$/u.test(snapshot.snapshot_ref),
        ),
      );
      const positionSets = Array.from({ length: 4 }, () => new Set());
      const firstCompletion = new Set();
      for (const entry of index.evidence_index.entries) {
        const siblings = index.evidence_index.snapshots.filter(
          (snapshot) =>
            snapshot.entry_type === entry.entry_type && snapshot.entry_id === entry.entry_id,
        );
        assert.equal(
          siblings.filter((snapshot) => snapshot.planned_at < index.horizon_end).length,
          2,
        );
        for (const [position, snapshot] of siblings.entries()) {
          if (snapshot.planned_at < index.horizon_end) {
            positionSets[position].add(entry.entry_id);
          }
        }
        const completed = index.evidence_index.publications
          .filter(
            (publication) =>
              publication.entry_type === entry.entry_type &&
              publication.entry_id === entry.entry_id &&
              publication.outcome === 'completed',
          )
          .sort(
            (left, right) =>
              left.event_time - right.event_time || left.arrival_order - right.arrival_order,
          );
        if (snapshots.get(completed[0].new_snapshot_ref).planned_at < index.horizon_end) {
          firstCompletion.add(entry.entry_id);
        }
      }
      for (const [position, heuristic] of positionSets.entries()) {
        assertShortcutFails(`snapshot position ${position}`, heuristic, selected, allIds);
      }
      assertShortcutFails('first completion', firstCompletion, selected, allIds);

      const pauseAll = visible.job_queue.map((job) => ({
        tool: 'pause-job',
        args: { job_uid: job.job_uid },
      }));
      const denyAll = visible.session_register.map((session) => ({
        tool: 'deny-role-session',
        args: { role_arn: session.role_arn, role_session_name: session.role_session_name },
      }));
      assert.equal(replayContainment(native, []).success, false);
      assert.equal(replayContainment(native, pauseAll).success, false);
      assert.equal(replayContainment(native, denyAll).success, false);
    }
  }
});
