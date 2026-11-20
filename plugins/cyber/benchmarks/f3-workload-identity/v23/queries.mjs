import { listWorkloads, querySession, querySource } from '../v22/queries.mjs';

export { listWorkloads, querySession, querySource };

export function queryWorkload(visible, jobUid) {
  if (!listWorkloads(visible).job_uids.includes(jobUid)) {
    return null;
  }
  const submissions = visible.events.filter(
    (event) => event.kind === 'job-submitted' && event.job_uid === jobUid,
  );
  const contextRefs = new Set(submissions.map((event) => event.auth_context_ref));
  const events = visible.events.filter(
    (event) =>
      (['job-submitted', 'job-admission'].includes(event.kind) && event.job_uid === jobUid) ||
      (event.kind === 'pod-started' && event.owner_job_uid === jobUid) ||
      (['release-token-redeemed', 'scheduled-job-authorized'].includes(event.kind) &&
        contextRefs.has(event.event_id)),
  );
  const streams = new Set(
    events
      .filter((event) => event.kind === 'job-admission')
      .flatMap((event) => [event.approval_stream_ref, event.owner_approval_stream_ref]),
  );
  const approvalSnapshots = visible.approval_snapshots.filter((item) =>
    streams.has(item.approval_stream_ref),
  );
  const auditStreams = new Set(approvalSnapshots.map((item) => item.audit_stream_ref));
  return {
    events,
    approval_snapshots: approvalSnapshots,
    approval_publications: visible.approval_publications.filter((item) =>
      streams.has(item.approval_stream_ref),
    ),
    membership_audit: visible.membership_audit.filter((item) =>
      auditStreams.has(item.audit_stream_ref),
    ),
    job_queue: visible.job_queue.filter((item) => item.job_uid === jobUid),
  };
}
