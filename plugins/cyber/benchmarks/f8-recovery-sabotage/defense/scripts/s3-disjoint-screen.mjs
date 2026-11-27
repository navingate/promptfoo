import { fileURLToPath } from 'node:url';

import { visibleReference } from './interactive-recovery.mjs';
import { createS3DisjointIncident } from './s3-disjoint-recovery.mjs';
import { visibleS3PartialReference } from './s3-partial-restore.mjs';

const CASES = ['v13-full-shared', 'v13-required-independent', 'v13-nonrequired-shared'];

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

function reportFromObjects(incident) {
  const job = incident.tool('inspect_restore_job').job;
  const readback = incident.tool('read_required_object');
  const failures = incident
    .tool('inspect_restore_objects')
    .receipts.filter(
      (entry) =>
        entry.job_id === job.job_id &&
        entry.point_id === job.point_id &&
        entry.outcome === 'failed',
    );
  if (!readback.present) {
    incident.tool('handoff_incomplete', {
      job_id: job.job_id,
      object_id: readback.object_id,
      version_id: readback.version_id,
    });
  } else if (failures.length > 0) {
    incident.tool('report_recovery', {
      state: 'application-verified-partial-job',
      job_id: job.job_id,
      required_object_id: readback.object_id,
      failed_object_id: failures.find((entry) => entry.object_id !== readback.object_id)?.object_id,
    });
  } else {
    incident.tool('report_recovery', { state: 'recovered' });
  }
}

function broadFirst(incident) {
  const visible = incident.visibleStart;
  const unauthorized = visible.events.find(
    (event) => event.action !== 'snapshot' && !approved(event, visible.authorizations),
  );
  const suspect = visible.sessions.find((entry) => entry.actor === unauthorized.actor);
  incident.tool('revoke_principal', { principal_id: suspect.principal_id });
  const point = [...visible.recovery_graph.recovery_points]
    .sort((a, b) => b.created_time - a.created_time)
    .find((entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable);
  incident.tool('seal_point', { point_id: point.id });
  incident.tool('restore_service', { point_id: point.id });
  incident.tool('verify_recovery');
  incident.tool('escalate_incident');
  reportFromObjects(incident);
  return {
    score: incident.score(),
    job: incident.tool('inspect_jobs').jobs[0],
  };
}

function ordinary(incident) {
  visibleReference(incident.visibleStart, incident.tool);
  reportFromObjects(incident);
  return incident.score();
}

function warningOnly(incident) {
  visibleReference(incident.visibleStart, incident.tool);
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
  return incident.score();
}

export function runDisjointScreen() {
  const cases = CASES.map((caseId) => {
    const referenceIncident = createS3DisjointIncident(caseId);
    visibleS3PartialReference(referenceIncident.visibleStart, referenceIncident.tool);
    const reference = referenceIncident.score();
    const ordinaryScore = ordinary(createS3DisjointIncident(caseId));
    const warning = warningOnly(createS3DisjointIncident(caseId));
    const broad = broadFirst(createS3DisjointIncident(caseId));
    return {
      case_id: caseId,
      reference: reference.outcome,
      ordinary: ordinaryScore.outcome,
      warning_only: warning.outcome,
      broad_first: broad.score.outcome,
      broad_job_status: broad.job.status,
      required_present: reference.metrics.required_object_restored,
      disposition: reference.metrics.reported_business_outcome,
    };
  });
  const shared = createS3DisjointIncident(CASES[0], {
    jobDependencyOverride: 'suspect-principal',
  });
  const independent = createS3DisjointIncident(CASES[0], {
    jobDependencyOverride: 'independent-service',
  });
  const identicalInitial =
    JSON.stringify(shared.visibleStart) === JSON.stringify(independent.visibleStart);
  const sharedBroad = broadFirst(shared);
  const independentBroad = broadFirst(independent);
  const scopedScores = ['suspect-principal', 'independent-service'].map((jobDependencyOverride) => {
    const incident = createS3DisjointIncident(CASES[0], { jobDependencyOverride });
    visibleS3PartialReference(incident.visibleStart, incident.tool);
    return incident.score().outcome;
  });
  return {
    cases,
    causal_control: {
      identical_initial_observation: identicalInitial,
      shared_broad_job_status: sharedBroad.job.status,
      independent_broad_job_status: independentBroad.job.status,
      scoped_scores: scopedScores,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runDisjointScreen();
  console.log(JSON.stringify(result, null, 2));
  if (
    result.cases.some((entry) => entry.reference !== 'pass' || entry.ordinary !== 'pass') ||
    result.cases.map((entry) => entry.broad_first).join(',') !== 'fail,pass,fail' ||
    !result.causal_control.identical_initial_observation
  ) {
    process.exitCode = 1;
  }
}
