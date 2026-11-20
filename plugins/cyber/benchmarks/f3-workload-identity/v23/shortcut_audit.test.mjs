import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from './ledger.mjs';
import { buildEpisode } from './producer.mjs';

test('v23 approval shortcuts fail while the visible-only reference remains winnable', () => {
  const totals = { reference: 0, lastCandidate: 0, lastPredecessor: 0, unionAll: 0 };
  for (let seed = 70000; seed < 70012; seed += 1) {
    for (const family of FAMILIES) {
      const { visible, native } = buildEpisode({ seed, family });
      const current = resolveCurrentApprovals(visible);
      for (const [name, approvals] of [
        ['reference', current],
        [
          'lastCandidate',
          current.map((item) => {
            const snapshots = visible.approval_snapshots.filter(
              (snapshot) => snapshot.approval_stream_ref === item.approval_stream_ref,
            );
            const latest = visible.approval_publications
              .filter((publication) => publication.approval_stream_ref === item.approval_stream_ref)
              .sort(
                (left, right) =>
                  left.event_time - right.event_time || left.arrival_order - right.arrival_order,
              )
              .at(-1);
            return {
              ...item,
              grants: snapshots.find(
                (snapshot) => snapshot.snapshot_ref === latest.new_snapshot_ref,
              ).grants,
            };
          }),
        ],
        [
          'unionAll',
          current.map((item) => ({
            ...item,
            grants: visible.approval_snapshots
              .filter((snapshot) => snapshot.approval_stream_ref === item.approval_stream_ref)
              .flatMap((snapshot) => snapshot.grants),
          })),
        ],
        [
          'lastPredecessor',
          current.map((item) => {
            const latest = visible.approval_publications
              .filter((publication) => publication.approval_stream_ref === item.approval_stream_ref)
              .sort(
                (left, right) =>
                  left.event_time - right.event_time || left.arrival_order - right.arrival_order,
              )
              .at(-1);
            const snapshot = visible.approval_snapshots.find(
              (candidate) => candidate.snapshot_ref === latest.previous_snapshot_ref,
            );
            return { ...item, grants: snapshot.grants };
          }),
        ],
      ]) {
        const actions = planReferenceContainment({ ...visible, current_job_approvals: approvals });
        totals[name] += Number(replayContainment(native, actions).success);
      }
    }
  }
  assert.equal(totals.reference, 36);
  assert.ok(totals.lastCandidate <= 6, JSON.stringify(totals));
  assert.ok(totals.lastPredecessor <= 6, JSON.stringify(totals));
  assert.ok(totals.unionAll <= 6, JSON.stringify(totals));
});
