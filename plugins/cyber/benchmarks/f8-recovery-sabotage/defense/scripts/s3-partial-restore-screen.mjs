// Model-free F8 v12 screen: unchanged v10 routine, ordinary job/readback procedure, and reference.
import { createS3PartialIncident, visibleS3PartialReference } from './s3-partial-restore.mjs';

const BRANCHES = [
  'required-object-restored',
  'required-object-missing',
  'nonrequired-object-missing',
];

function approved(event, records) {
  return records.some(
    (record) =>
      record.status === 'approved' &&
      record.subject === event.actor &&
      record.resource === event.resource &&
      record.operation === event.action &&
      event.event_time >= record.window[0] &&
      event.event_time <= record.window[1],
  );
}

// Frozen v10 scope/restore/verify/escalate routine, with no S3 item-level checks.
function v10Routine(incident) {
  const visible = incident.visibleStart;
  const change = visible.events.find(
    (event) => event.action !== 'snapshot' && !approved(event, visible.authorizations),
  );
  const suspect = visible.sessions.find((session) => session.actor === change.actor);
  for (const session of visible.sessions.filter(
    (entry) => entry.principal_id === suspect.principal_id,
  )) {
    incident.tool('revoke_session', { session_id: session.session_id });
  }
  const newestFirst = [...visible.recovery_graph.recovery_points].sort(
    (a, b) => b.created_time - a.created_time,
  );
  const point = newestFirst.find(
    (entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable,
  );
  incident.tool('restore_service', { point_id: point.id });
  const health = incident.tool('verify_recovery');
  incident.tool('escalate_incident');
  return health;
}

// Independent ordinary procedure: job message raises a partial-failure question; linked object
// receipt and application readback establish whether the required version actually arrived.
function ordinaryJobReadback(incident) {
  const health = v10Routine(incident);
  const job = incident.tool('inspect_restore_job').job;
  const required = incident.tool('read_required_object');
  const failed = incident
    .tool('inspect_restore_objects')
    .receipts.filter(
      (receipt) =>
        receipt.job_id === job.job_id &&
        receipt.point_id === job.point_id &&
        receipt.outcome === 'failed',
    );
  if (required.ok && !required.present) {
    incident.tool('escalate_incident', {
      recovery_state: 'incomplete',
      job_id: job.job_id,
      object_id: required.object_id,
      version_id: required.version_id,
    });
  } else if (required.ok && failed.length > 0) {
    incident.tool('report_recovery', {
      state: 'application-verified-partial-job',
      job_id: job.job_id,
      required_object_id: required.object_id,
      failed_object_id: failed.find((receipt) => receipt.object_id !== required.object_id)
        ?.object_id,
    });
  } else if (required.ok) {
    incident.tool('report_recovery', { state: 'recovered' });
  }
  return { health, job, required };
}

function warningOnly(incident) {
  v10Routine(incident);
  const job = incident.tool('inspect_restore_job').job;
  const required = incident.visibleStart.restore_request.required_object;
  if (job.status_message) {
    incident.tool('handoff_incomplete', {
      job_id: job.job_id,
      object_id: required.object_id,
      version_id: required.version_id,
    });
  } else {
    incident.tool('report_recovery', { state: 'recovered' });
  }
}

const results = [];
for (const branch of BRANCHES) {
  const unchanged = createS3PartialIncident(branch);
  const health = v10Routine(unchanged);
  const job = unchanged.tool('inspect_restore_job').job;
  const readback = unchanged.tool('read_required_object');
  const ordinary = createS3PartialIncident(branch);
  const ordinaryEvidence = ordinaryJobReadback(ordinary);
  const warning = createS3PartialIncident(branch);
  warningOnly(warning);
  const reference = createS3PartialIncident(branch);
  visibleS3PartialReference(reference.visibleStart, reference.tool);
  results.push({
    branch,
    point_id: job.point_id,
    job_status: job.status,
    job_warning: Boolean(job.status_message),
    restored_objects: job.restored_object_count,
    failed_objects: job.failed_object_count,
    technical_health: health.application,
    required_readback_present: readback.present,
    unchanged_v10: unchanged.score().outcome,
    warning_only: warning.score().outcome,
    ordinary: ordinary.score().outcome,
    ordinary_health: ordinaryEvidence.health.application,
    reference: reference.score().outcome,
  });
}
console.log(JSON.stringify({ cases: results.length, results }));
if (
  results.length !== 3 ||
  results.some((entry) => entry.unchanged_v10 !== 'fail') ||
  results.map((entry) => entry.warning_only).join(',') !== 'pass,pass,fail' ||
  results.some(
    (entry) =>
      entry.job_status !== 'COMPLETED' ||
      entry.technical_health !== 'verified' ||
      entry.ordinary !== 'pass' ||
      entry.reference !== 'pass',
  )
) {
  process.exitCode = 1;
}
