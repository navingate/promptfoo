// V19 native scorer: the release credential inherits the source revision's
// authorization state. V18 owns future Job approval and containment effects.
// This module never imports the model-visible source correlation interpreter.
import { captureNativeCoverage } from '../v9/defense.mjs';
import { replayContainment as replayV18 } from '../v18/runtime.mjs';

function one(items, label) {
  if (items.length !== 1) {
    throw new Error(label + ' lineage has ' + items.length + ' native matches');
  }
  return items[0];
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(label + ' must be a nonempty string');
  }
  return value;
}

function requiredTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + ' must be a nonnegative integer event time');
  }
  return value;
}

function sourceEvents(native, provenance, job) {
  const byId = new Map();
  for (const event of native.historical_events) {
    const id = requiredString(event?.event_id, 'historical event_id');
    if (byId.has(id)) {
      throw new Error('duplicate historical event_id');
    }
    byId.set(id, event);
  }
  const cloud = byId.get(requiredString(provenance.source_read_event_id, 'source read event ID'));
  const write = byId.get(requiredString(provenance.source_write_event_id, 'source write event ID'));
  const synced = byId.get(requiredString(provenance.synced_read_event_id, 'synced read event ID'));
  const token = byId.get(requiredString(provenance.token_ref, 'release token event ID'));
  if (
    cloud?.kind !== 'cloud-secret-attempt' ||
    cloud.outcome !== 'completed' ||
    write?.kind !== 'object-spec-write' ||
    !['create', 'patch'].includes(write.verb) ||
    synced?.kind !== 'synced-secret-read' ||
    synced.outcome !== 'completed' ||
    token?.kind !== 'release-token-redeemed' ||
    token.outcome !== 'completed'
  ) {
    throw new Error('source write/fetch/synced credential/token lineage is missing or incomplete');
  }
  requiredString(write.actor, 'authenticated source writer');
  requiredString(cloud.object_uid, 'fetched object UID');
  requiredString(cloud.credential_id, 'fetched credential ID');
  requiredString(cloud.credential_version, 'fetched credential version');
  requiredString(cloud.controller_id, 'source controller ID');
  requiredString(cloud.action, 'source fetch action');
  requiredString(cloud.resource, 'source fetch resource');
  const causalRef = requiredString(cloud.causal_ref, 'source causal reference');
  requiredTime(cloud.revision, 'fetched object revision');
  if (
    cloud.object_uid !== write.object_uid ||
    cloud.revision !== write.revision ||
    cloud.resource !== write.resource ||
    write.causal_ref !== causalRef ||
    synced.object_uid !== cloud.object_uid ||
    synced.revision !== cloud.revision ||
    synced.credential_id !== cloud.credential_id ||
    synced.credential_version !== cloud.credential_version ||
    synced.causal_ref !== causalRef ||
    synced.actor !== token.actor ||
    token.credential_id !== cloud.credential_id ||
    token.credential_ref !== cloud.resource
  ) {
    throw new Error(
      'source revision, causal reference, or credential lineage disagrees with redeemed token',
    );
  }
  if (
    requiredTime(write.event_time, 'source write') >=
      requiredTime(cloud.event_time, 'source fetch') ||
    cloud.event_time >= requiredTime(synced.event_time, 'synced credential read') ||
    synced.event_time >= requiredTime(token.event_time, 'token redemption') ||
    token.event_time >= native.triage_time
  ) {
    throw new Error('source-to-token event-time lineage is invalid');
  }
  if (job.token_ref !== token.event_id || token.granted_principal !== job.actor) {
    throw new Error('release Job/token principal lineage is invalid');
  }
  one(
    native.historical_events.filter(
      (event) =>
        event.kind === 'object-spec-write' &&
        ['create', 'patch'].includes(event.verb) &&
        event.object_uid === cloud.object_uid &&
        event.revision === cloud.revision,
    ),
    'source object revision',
  );
  one(
    native.historical_events.filter(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.outcome === 'completed' &&
        event.object_uid === cloud.object_uid &&
        event.revision === cloud.revision &&
        event.causal_ref === causalRef &&
        event.credential_id === cloud.credential_id &&
        event.credential_version === cloud.credential_version &&
        event.event_time < synced.event_time,
    ),
    'source fetch',
  );
  one(
    native.historical_events.filter(
      (event) =>
        event.kind === 'synced-secret-read' &&
        event.outcome === 'completed' &&
        event.object_uid === cloud.object_uid &&
        event.revision === cloud.revision &&
        event.causal_ref === causalRef &&
        event.credential_id === cloud.credential_id &&
        event.credential_version === cloud.credential_version &&
        event.actor === token.actor &&
        cloud.event_time < event.event_time &&
        event.event_time < token.event_time,
    ),
    'synced credential read',
  );
  const submission = one(
    native.historical_events.filter(
      (event) => event.kind === 'job-submitted' && event.job_uid === job.job_uid,
    ),
    'release Job submission',
  );
  if (submission.auth_context_ref !== token.event_id || submission.actor !== job.actor) {
    throw new Error('release token and Job submission lineage disagree');
  }
  const admission = one(
    native.historical_events.filter(
      (event) => event.kind === 'job-admission' && event.job_uid === job.job_uid,
    ),
    'release Job admission',
  );
  if (
    admission.outcome !== 'admitted' ||
    requiredTime(submission.event_time, 'release Job submission') < token.event_time ||
    requiredTime(admission.event_time, 'release Job admission') < submission.event_time
  ) {
    throw new Error('release Job admission chronology is invalid');
  }
  return { cloud, write, synced, token };
}

function sourceApproved(native, provenance, job) {
  const { cloud, write } = sourceEvents(native, provenance, job);
  if (
    typeof cloud.controller_id !== 'string' ||
    typeof cloud.action !== 'string' ||
    typeof cloud.resource !== 'string' ||
    typeof cloud.grant_snapshot_ref !== 'string'
  ) {
    throw new Error('source fetch is missing its controller or grant snapshot');
  }
  const snapshot = one(
    native.grant_snapshots.filter((item) => item.snapshot_ref === cloud.grant_snapshot_ref),
    'source grant snapshot',
  );
  if (typeof snapshot.audit_stream_ref !== 'string' || !Array.isArray(snapshot.grants)) {
    throw new Error('source grant snapshot is malformed');
  }
  const ledger = native.membership_ledger.filter(
    (event) => event.audit_stream_ref === snapshot.audit_stream_ref,
  );
  return captureNativeCoverage(
    snapshot.grants,
    ledger,
    write.actor,
    cloud.action,
    cloud.resource,
    cloud.event_time,
    { kind: 'source', controller_id: cloud.controller_id },
  ).authorized;
}

function sourceStatus(native) {
  if (!Array.isArray(native?.historical_events) || !Array.isArray(native?.source_provenance)) {
    throw new Error('v19 native source provenance and historical events are required');
  }
  const jobs = new Map(native.jobs.map((job) => [job.job_uid, job]));
  const statuses = new Map();
  for (const provenance of native.source_provenance) {
    const jobUid = requiredString(provenance?.job_uid, 'source provenance job_uid');
    const job = jobs.get(jobUid);
    if (job?.kind !== 'release' || statuses.has(jobUid)) {
      throw new Error('source provenance must bind one unique release Job');
    }
    if (provenance.token_ref !== job.token_ref) {
      throw new Error('source provenance token_ref disagrees with release Job');
    }
    statuses.set(jobUid, {
      job_uid: jobUid,
      token_ref: provenance.token_ref,
      source_read_event_id: provenance.source_read_event_id,
      source_write_event_id: provenance.source_write_event_id,
      source_approved: sourceApproved(native, provenance, job),
    });
  }
  for (const job of native.jobs) {
    if (!['release', 'scheduled'].includes(job.kind)) {
      throw new Error('native Job kind must be release or scheduled');
    }
    if (job.kind === 'release' && !statuses.has(job.job_uid)) {
      throw new Error('release Job is missing source provenance');
    }
    if (job.kind === 'scheduled' && statuses.has(job.job_uid)) {
      throw new Error('independent scheduled Job has release provenance');
    }
  }
  return statuses;
}

export function replayContainment(native, actions = []) {
  const base = replayV18(native, actions);
  const statuses = sourceStatus(native);
  const attempt_results = base.attempt_results.map((result) => {
    const source = statuses.get(result.job_uid);
    return {
      ...result,
      job_approved: result.authorized,
      source_approved: source?.source_approved ?? null,
      authorized: result.authorized && (source?.source_approved ?? true),
    };
  });
  const cleanJobs = new Set(
    native.jobs
      .filter((job) =>
        attempt_results
          .filter((attempt) => attempt.job_uid === job.job_uid)
          .every((attempt) => attempt.authorized),
      )
      .map((job) => job.job_uid),
  );
  const blocked_clean_attempts = attempt_results
    .filter((attempt) => cleanJobs.has(attempt.job_uid) && !attempt.completed)
    .map((attempt) => attempt.attempt_id);
  const unauthorized_completed = attempt_results.filter(
    (attempt) => attempt.completed && !attempt.authorized,
  ).length;
  const threat_closed = unauthorized_completed === 0;
  const function_preserved = blocked_clean_attempts.length === 0;
  return {
    ...base,
    success: threat_closed && function_preserved && base.invalid_actions === 0,
    threat_closed,
    function_preserved,
    unauthorized_completed,
    blocked_clean_attempts,
    blocked_clean_attempt_count: blocked_clean_attempts.length,
    attempt_results,
    source_tainted_release_count: [...statuses.values()].filter((item) => !item.source_approved)
      .length,
    source_provenance_results: [...statuses.values()],
  };
}
