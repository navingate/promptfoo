import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { projectVisible } from '../v20/producer.mjs';
import { buildNativeEpisode } from '../v21/producer.mjs';
import { resolveCurrentApprovals } from './ledger.mjs';
import { buildEpisode } from './producer.mjs';

test('v23 publishes the revision journal without precomputed current approval', () => {
  const episode = buildEpisode({ seed: 70000, family: FAMILIES[0] });
  assert.equal(Object.hasOwn(episode.visible, 'current_job_approvals'), false);
  assert.ok(episode.visible.approval_snapshots.length > 12);
  assert.ok(episode.visible.approval_publications.some((item) => item.outcome === 'failed'));
  assert.ok(episode.visible.approval_publications.some((item) => item.outcome === 'completed'));
  assert.doesNotMatch(
    JSON.stringify(episode.visible),
    /"(?:native|authorized|source_provenance|attempt_results)"\s*:/u,
  );
  const current = resolveCurrentApprovals(episode.visible);
  for (const owner of current) {
    const latest = episode.visible.approval_publications
      .filter((item) => item.approval_stream_ref === owner.approval_stream_ref)
      .sort(
        (left, right) =>
          left.event_time - right.event_time || left.arrival_order - right.arrival_order,
      )
      .at(-1);
    assert.equal(latest.outcome, 'failed');
    assert.equal(latest.failure_reason, 'stale-predecessor');
    assert.notEqual(latest.previous_snapshot_ref, owner.snapshot_ref);
    const candidate = episode.visible.approval_snapshots.find(
      (item) => item.snapshot_ref === latest.new_snapshot_ref,
    );
    assert.notDeepEqual(candidate.grants, owner.grants);
    assert.ok(
      episode.native.approval_publications.some((item) => item.event_id === latest.event_id),
    );
    assert.ok(
      episode.native.grant_snapshots.some((item) => item.snapshot_ref === candidate.snapshot_ref),
    );
  }
});

test('v23 effective approvals agree with the existing native-derived projection across paired cases', () => {
  for (const seed of [70000, 70001, 70002, 70003]) {
    for (const family of FAMILIES) {
      const spec = { seed, family };
      const expected = projectVisible(
        buildNativeEpisode(spec, { requirePersistentJobDenial: true }),
        { minJobs: 5, maxJobs: 6 },
      ).current_job_approvals;
      const actual = resolveCurrentApprovals(buildEpisode(spec).visible);
      assert.deepEqual(actual, expected, `${seed}/${family}`);
    }
  }
});

test('v23 rejects missing or conflicting journal lineage', () => {
  const visible = buildEpisode({ seed: 70000, family: FAMILIES[0] }).visible;
  const missing = structuredClone(visible);
  missing.approval_snapshots.shift();
  assert.throws(() => resolveCurrentApprovals(missing), /snapshot|lineage|missing/u);

  const conflict = structuredClone(visible);
  const publication = conflict.approval_publications.find((item) => item.outcome === 'completed');
  publication.previous_snapshot_ref = 'unknown-snapshot';
  assert.throws(() => resolveCurrentApprovals(conflict), /snapshot|lineage|missing/u);
});

test('v23 paired cases share the same failed bulk proposal evidence', () => {
  const even = buildEpisode({ seed: 70000, family: FAMILIES[0] }).visible;
  const odd = buildEpisode({ seed: 70001, family: FAMILIES[0] }).visible;
  const proposal = (visible) => {
    const publications = visible.approval_publications
      .filter((item) => item.batch_ref)
      .sort((left, right) => left.event_id.localeCompare(right.event_id));
    const refs = new Set(publications.map((item) => item.new_snapshot_ref));
    const snapshots = visible.approval_snapshots
      .filter((item) => refs.has(item.snapshot_ref))
      .sort((left, right) => left.snapshot_ref.localeCompare(right.snapshot_ref));
    return { publications, snapshots };
  };
  assert.deepEqual(proposal(even), proposal(odd));
});
