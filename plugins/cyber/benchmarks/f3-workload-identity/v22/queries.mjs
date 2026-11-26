// A small read-only SOC console over published v21 evidence. Query membership
// is computed solely from the model-visible episode, never native replay.
const SOURCE_KINDS = new Set([
  'object-spec-write',
  'controller-reconcile',
  'cloud-secret-attempt',
  'synced-secret-read',
  'release-token-redeemed',
]);

function eventsOf(visible, kind) {
  return visible.events.filter((event) => event.kind === kind);
}

function unique(values) {
  return [...new Set(values)];
}

export function listWorkloads(visible) {
  return {
    triage_time: visible.triage_time,
    arrival_watermark: visible.arrival_watermark,
    horizon_end: visible.horizon_end,
    job_uids: unique(eventsOf(visible, 'job-admission').map((event) => event.job_uid)),
    credential_ids: unique(
      eventsOf(visible, 'release-token-redeemed').map((event) => event.credential_id),
    ),
    access_key_refs: unique(visible.session_register.map((session) => session.access_key_ref)),
    ...(visible.incident_events ? { incident_events: visible.incident_events } : {}),
  };
}

export function querySource(visible, credentialId) {
  if (!listWorkloads(visible).credential_ids.includes(credentialId)) {
    return null;
  }
  const fetches = eventsOf(visible, 'cloud-secret-attempt').filter(
    (event) => event.credential_id === credentialId,
  );
  const objectUids = new Set(fetches.map((event) => event.object_uid));
  const events = visible.events.filter(
    (event) =>
      SOURCE_KINDS.has(event.kind) &&
      (event.credential_id === credentialId || objectUids.has(event.object_uid)),
  );
  const snapshotRefs = new Set(
    events
      .filter((event) => event.kind === 'cloud-secret-attempt')
      .map((event) => event.grant_snapshot_ref),
  );
  const grantSnapshots = visible.grant_snapshots.filter((item) =>
    snapshotRefs.has(item.snapshot_ref),
  );
  const auditStreams = new Set(grantSnapshots.map((item) => item.audit_stream_ref));
  return {
    events,
    grant_snapshots: grantSnapshots,
    membership_audit: visible.membership_audit.filter((item) =>
      auditStreams.has(item.audit_stream_ref),
    ),
  };
}

export function queryWorkload(visible, jobUid) {
  if (!listWorkloads(visible).job_uids.includes(jobUid)) {
    return null;
  }
  const submissions = eventsOf(visible, 'job-submitted').filter(
    (event) => event.job_uid === jobUid,
  );
  const contextRefs = new Set(submissions.map((event) => event.auth_context_ref));
  const events = visible.events.filter(
    (event) =>
      (['job-submitted', 'job-admission'].includes(event.kind) && event.job_uid === jobUid) ||
      (event.kind === 'pod-started' && event.owner_job_uid === jobUid) ||
      (['release-token-redeemed', 'scheduled-job-authorized'].includes(event.kind) &&
        contextRefs.has(event.event_id)),
  );
  const approvals = visible.current_job_approvals.filter((item) => item.job_uid === jobUid);
  const auditStreams = new Set(approvals.map((item) => item.audit_stream_ref));
  return {
    events,
    current_job_approvals: approvals,
    membership_audit: visible.membership_audit.filter((item) =>
      auditStreams.has(item.audit_stream_ref),
    ),
    job_queue: visible.job_queue.filter((item) => item.job_uid === jobUid),
  };
}

export function querySession(visible, accessKeyRef) {
  const session = visible.session_register.find((item) => item.access_key_ref === accessKeyRef);
  if (!session) {
    return null;
  }
  const roleEvents = eventsOf(visible, 'sts-assume-role').filter(
    (event) => event.access_key_ref === accessKeyRef,
  );
  const sourceRefs = new Set(roleEvents.map((event) => event.source_access_key_ref));
  const webEvents = eventsOf(visible, 'sts-assume-web-identity').filter((event) =>
    sourceRefs.has(event.access_key_ref),
  );
  const runtimeEvents = eventsOf(visible, 'runtime-credential-request').filter((event) =>
    webEvents.some(
      (web) => web.role_session_name === event.role_session_name && web.actor === event.actor,
    ),
  );
  const podUids = new Set(runtimeEvents.map((event) => event.pod_uid));
  const ids = new Set(
    [...roleEvents, ...webEvents, ...runtimeEvents].map((event) => event.event_id),
  );
  const events = visible.events.filter(
    (event) =>
      ids.has(event.event_id) || (event.kind === 'pod-started' && podUids.has(event.pod_uid)),
  );
  return {
    events,
    session_register: [session],
    policy_snapshots: visible.policy_snapshots,
  };
}
