const TYPES = {
  credential: 'credential_ids',
  job: 'job_uids',
  session: 'access_key_refs',
};

function effectiveSnapshot(journal, index, snapshots, entry) {
  let currentRef = entry.base_snapshot_ref;
  const publications = journal.publications
    .filter((item) => item.entry_type === entry.entry_type && item.entry_id === entry.entry_id)
    .sort(
      (left, right) =>
        left.event_time - right.event_time || left.arrival_order - right.arrival_order,
    );
  for (const publication of publications) {
    if (
      publication.event_time > index.triage_time ||
      !snapshots.has(publication.new_snapshot_ref)
    ) {
      throw new Error('v30 index publication is not visible at triage');
    }
    if (publication.failure_reason === 'stale-predecessor') {
      if (publication.outcome !== 'failed' || publication.previous_snapshot_ref === currentRef) {
        throw new Error('v30 stale index proposal has inconsistent lineage');
      }
      continue;
    }
    if (publication.previous_snapshot_ref !== currentRef) {
      throw new Error('v30 index publication predecessor conflicts');
    }
    if (publication.outcome === 'completed') {
      currentRef = publication.new_snapshot_ref;
    } else if (publication.outcome !== 'failed') {
      throw new Error('v30 index publication has unknown outcome');
    }
  }
  const current = snapshots.get(currentRef);
  if (
    !current ||
    current.entry_type !== entry.entry_type ||
    current.entry_id !== entry.entry_id ||
    !Number.isSafeInteger(current.planned_at)
  ) {
    throw new Error('v30 effective index snapshot conflicts');
  }
  return current;
}

export function resolveIndex(index) {
  const journal = index?.evidence_index;
  if (
    !Number.isSafeInteger(index?.triage_time) ||
    !Number.isSafeInteger(index?.horizon_end) ||
    !Array.isArray(journal?.entries) ||
    !Array.isArray(journal?.snapshots) ||
    !Array.isArray(journal?.publications)
  ) {
    throw new Error('v30 evidence index is missing');
  }
  const snapshots = new Map(journal.snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]));
  if (snapshots.size !== journal.snapshots.length) {
    throw new Error('v30 evidence snapshots have duplicate references');
  }
  const selected = { credential_ids: [], job_uids: [], access_key_refs: [] };
  const seen = new Set();
  for (const entry of journal.entries) {
    const collection = TYPES[entry.entry_type];
    const identity = `${entry.entry_type}\0${entry.entry_id}`;
    if (!collection || seen.has(identity) || !index[collection]?.includes(entry.entry_id)) {
      throw new Error('v30 evidence entry is duplicated or unindexed');
    }
    seen.add(identity);
    const current = effectiveSnapshot(journal, index, snapshots, entry);
    if (index.triage_time <= current.planned_at && current.planned_at < index.horizon_end) {
      selected[collection].push(entry.entry_id);
    }
  }
  if (
    seen.size !==
    index.credential_ids.length + index.job_uids.length + index.access_key_refs.length
  ) {
    throw new Error('v30 evidence entries do not cover the index');
  }
  return selected;
}
