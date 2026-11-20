function one(items, label) {
  if (items.length !== 1) {
    throw new Error(`${label} lineage is ${items.length === 0 ? 'missing' : 'ambiguous'}`);
  }
  return items[0];
}

function byTime(left, right) {
  return left.event_time - right.event_time || left.arrival_order - right.arrival_order;
}

function effectiveSnapshot(visible, stream, base) {
  const snapshots = visible.approval_snapshots.filter(
    (item) => item.approval_stream_ref === stream,
  );
  const byRef = new Map(snapshots.map((item) => [item.snapshot_ref, item]));
  if (byRef.size !== snapshots.length || !byRef.has(base)) {
    throw new Error('approval snapshot lineage is missing or ambiguous');
  }
  let currentRef = base;
  const publications = visible.approval_publications
    .filter((item) => item.approval_stream_ref === stream)
    .sort(byTime);
  for (const publication of publications) {
    if (publication.event_time > visible.triage_time || !byRef.has(publication.new_snapshot_ref)) {
      throw new Error('approval publication snapshot lineage conflicts');
    }
    if (publication.failure_reason === 'stale-predecessor') {
      if (
        publication.outcome !== 'failed' ||
        publication.previous_snapshot_ref === currentRef ||
        !byRef.has(publication.previous_snapshot_ref)
      ) {
        throw new Error('stale approval publication snapshot lineage conflicts');
      }
      continue;
    }
    if (publication.previous_snapshot_ref !== currentRef) {
      throw new Error('approval publication snapshot lineage conflicts');
    }
    if (publication.outcome === 'completed') {
      currentRef = publication.new_snapshot_ref;
    } else if (publication.outcome !== 'failed') {
      throw new Error('approval publication outcome conflicts');
    }
  }
  const current = byRef.get(currentRef);
  if (!Array.isArray(current.grants) || typeof current.audit_stream_ref !== 'string') {
    throw new Error('effective approval snapshot is malformed');
  }
  return current;
}

export function resolveCurrentApprovals(visible) {
  if (
    !Array.isArray(visible?.events) ||
    !Array.isArray(visible.approval_snapshots) ||
    !Array.isArray(visible.approval_publications) ||
    !Number.isSafeInteger(visible.triage_time)
  ) {
    throw new Error('approval journal is missing');
  }
  const submissions = visible.events.filter((event) => event.kind === 'job-submitted');
  const admissions = visible.events.filter(
    (event) => event.kind === 'job-admission' && event.outcome === 'admitted',
  );
  if (submissions.length !== admissions.length) {
    throw new Error('Job approval lineage is missing');
  }
  const resolved = [];
  const usedStreams = new Set();
  for (const admission of admissions) {
    const submission = one(
      submissions.filter((item) => item.job_uid === admission.job_uid),
      'Job submission',
    );
    if (admission.causal_ref !== submission.event_id) {
      throw new Error('Job approval lineage conflicts');
    }
    for (const [lane, stream, base] of [
      ['change', admission.approval_stream_ref, submission.grant_snapshot_ref],
      ['owner', admission.owner_approval_stream_ref, submission.owner_snapshot_ref],
    ]) {
      if (typeof stream !== 'string' || !stream || usedStreams.has(stream)) {
        throw new Error('approval stream lineage conflicts');
      }
      usedStreams.add(stream);
      const current = effectiveSnapshot(visible, stream, base);
      resolved.push({
        job_uid: admission.job_uid,
        lane,
        approval_stream_ref: stream,
        snapshot_ref: current.snapshot_ref,
        audit_stream_ref: current.audit_stream_ref,
        grants: current.grants,
      });
    }
  }
  return resolved;
}
