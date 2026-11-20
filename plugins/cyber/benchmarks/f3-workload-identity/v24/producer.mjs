import { sha256Hex } from '../shared/estate.mjs';
import { buildEpisode as buildV23Episode } from '../v23/producer.mjs';

export function buildEpisode(spec, options = {}) {
  const episode = buildV23Episode(spec, {
    phaseAware: true,
    densePhaseAware: options.densePhaseAware === true,
    expandedCohort: options.expandedCohort === true,
  });
  const visibleSnapshots = new Map(
    episode.visible.approval_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const nativeSnapshots = new Map(
    episode.native.grant_snapshots.map((item) => [item.snapshot_ref, item]),
  );
  const rejectedBulkByStream = new Map();
  for (const publication of episode.visible.approval_publications) {
    if (publication.outcome === 'failed' && publication.failure_reason === 'stale-predecessor') {
      rejectedBulkByStream.set(publication.approval_stream_ref, publication.new_snapshot_ref);
    }
  }
  for (const publication of episode.visible.approval_publications) {
    if (publication.outcome !== 'failed' || publication.failure_reason) {
      continue;
    }
    const proposal = visibleSnapshots.get(
      rejectedBulkByStream.get(publication.approval_stream_ref),
    );
    const visible = visibleSnapshots.get(publication.new_snapshot_ref);
    const native = nativeSnapshots.get(publication.new_snapshot_ref);
    if (!proposal || !visible || !native) {
      throw new Error('failed approval proposal is missing a published snapshot');
    }
    const grants = proposal.grants.map((grant) => ({
      ...structuredClone(grant),
      grant_id: `jobgrant-${sha256Hex(`${visible.snapshot_ref}|${grant.task.action}|${grant.task.remote_ref}`).slice(0, 20)}`,
    }));
    visible.grants = grants;
    native.grants = structuredClone(grants);
  }
  return episode;
}
