import { buildEpisode as buildV19Episode } from '../v19/producer.mjs';

const RETAINED_EVENT_KINDS = new Set([
  'object-spec-write',
  'controller-reconcile',
  'cloud-secret-attempt',
  'synced-secret-read',
  'release-token-redeemed',
  'job-submitted',
  'job-admission',
  'pod-started',
  'runtime-credential-request',
  'sts-assume-web-identity',
  'sts-assume-role',
  'scheduled-job-authorized',
]);

function withoutAvailability(record) {
  const { available_at: _availableAt, ...retained } = record;
  return retained;
}

function exactlyOne(records, predicate, description) {
  const matches = records.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`expected one ${description}, found ${matches.length}`);
  }
  return matches[0];
}

function currentApproval(visible, submission, admission, lane) {
  const baseRef = lane === 'change' ? submission.grant_snapshot_ref : submission.owner_snapshot_ref;
  const streamRef =
    lane === 'change' ? admission.approval_stream_ref : admission.owner_approval_stream_ref;
  const snapshots = visible.grant_snapshots.filter(
    (snapshot) => snapshot.approval_stream_ref === streamRef,
  );
  const byRef = new Map(snapshots.map((snapshot) => [snapshot.snapshot_ref, snapshot]));
  if (byRef.size !== snapshots.length || !byRef.has(baseRef)) {
    throw new Error('approval snapshot lineage is missing or ambiguous');
  }
  let currentRef = baseRef;
  const publications = visible.approval_publications
    .filter((publication) => publication.approval_stream_ref === streamRef)
    .sort(
      (left, right) =>
        left.event_time - right.event_time || left.arrival_order - right.arrival_order,
    );
  for (const publication of publications) {
    if (
      publication.event_time > visible.triage_time ||
      publication.previous_snapshot_ref !== currentRef ||
      !byRef.has(publication.new_snapshot_ref)
    ) {
      throw new Error('approval publication lineage is invalid');
    }
    if (publication.outcome === 'completed') {
      currentRef = publication.new_snapshot_ref;
    } else if (publication.outcome !== 'failed') {
      throw new Error('approval publication outcome is invalid');
    }
  }
  const current = byRef.get(currentRef);
  return {
    job_uid: admission.job_uid,
    lane,
    approval_stream_ref: streamRef,
    snapshot_ref: currentRef,
    audit_stream_ref: current.audit_stream_ref,
    grants: current.grants,
  };
}

export function projectVisible(episode, { minJobs = 4, maxJobs = 4, allowExpanded = false } = {}) {
  const { visible, native } = episode;
  if (
    !Number.isSafeInteger(minJobs) ||
    !Number.isSafeInteger(maxJobs) ||
    minJobs < 3 ||
    maxJobs > (allowExpanded ? 12 : 6) ||
    minJobs > maxJobs
  ) {
    throw new Error(
      allowExpanded
        ? 'compact SOC job-count bounds must be within three to twelve'
        : 'compact SOC job-count bounds must be within three to six',
    );
  }
  if (
    native.approval_publications.some(
      (publication) =>
        publication.event_time > visible.triage_time &&
        publication.event_time <= visible.horizon_end,
    )
  ) {
    throw new Error('approval publication after triage within replay horizon');
  }
  if (
    native.membership_ledger.some(
      (event) => event.event_time > visible.triage_time && event.event_time <= visible.horizon_end,
    )
  ) {
    throw new Error('membership change after triage within replay horizon');
  }
  const admissions = visible.events.filter(
    (event) => event.kind === 'job-admission' && event.outcome === 'admitted',
  );
  if (admissions.length < minJobs || admissions.length > maxJobs) {
    throw new Error(
      minJobs === maxJobs
        ? `expected ${minJobs === 4 ? 'four' : minJobs} admitted Jobs, found ${admissions.length}`
        : `expected ${minJobs}-${maxJobs} admitted Jobs, found ${admissions.length}`,
    );
  }
  if (new Set(admissions.map((admission) => admission.job_uid)).size !== admissions.length) {
    throw new Error('duplicate admitted Job in approval view');
  }
  const currentJobApprovals = admissions.flatMap((admission) => {
    const submission = exactlyOne(
      visible.events,
      (event) => event.kind === 'job-submitted' && event.job_uid === admission.job_uid,
      'Job submission',
    );
    return [
      currentApproval(visible, submission, admission, 'change'),
      currentApproval(visible, submission, admission, 'owner'),
    ];
  });
  return {
    triage_time: visible.triage_time,
    arrival_watermark: visible.arrival_watermark,
    horizon_end: visible.horizon_end,
    events: visible.events
      .filter((event) => RETAINED_EVENT_KINDS.has(event.kind))
      .map(withoutAvailability),
    grant_snapshots: visible.grant_snapshots
      .filter((snapshot) => !snapshot.approval_stream_ref)
      .map(withoutAvailability),
    current_job_approvals: currentJobApprovals,
    membership_audit: visible.membership_audit.map(withoutAvailability),
    policy_snapshots: visible.policy_snapshots.map(withoutAvailability),
    session_register: visible.session_register.map(withoutAvailability),
    job_queue: visible.job_queue.map(withoutAvailability),
  };
}

export function buildEpisode(spec) {
  const episode = buildV19Episode(spec);
  return { native: episode.native, visible: projectVisible(episode) };
}
