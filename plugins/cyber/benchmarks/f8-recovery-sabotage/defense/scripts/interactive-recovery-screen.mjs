// Model-free screen of the strongest routine response. No model or network calls.
import { readFileSync } from 'node:fs';

import { createIncident, visibleReference } from './interactive-recovery.mjs';

const capture = new URL(
  '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
  import.meta.url,
);
const rows = readFileSync(capture, 'utf8').trimEnd().split('\n').map(JSON.parse);

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

function runRoutine(incident, policy) {
  const visible = incident.visibleStart;
  const suspectEvent = visible.events.find(
    (event) => event.action !== 'snapshot' && !approved(event, visible.authorizations),
  );
  const suspect = visible.sessions.find((session) => session.actor === suspectEvent?.actor);
  const targets =
    policy === 'blanket'
      ? visible.sessions
      : visible.sessions.filter((entry) => entry.principal_id === suspect?.principal_id);
  for (const session of targets) {
    incident.tool('revoke_session', { session_id: session.session_id });
  }
  if (!suspectEvent) {
    return { score: incident.score(), job: incident.tool('inspect_jobs').jobs[0] ?? null };
  }
  const newestFirst = [...visible.recovery_graph.recovery_points].sort(
    (a, b) => b.created_time - a.created_time,
  );
  const point = newestFirst.find(
    (entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable,
  );
  if (point && visible.evidence.production_damaged) {
    incident.tool('restore_service', { point_id: point.id });
    incident.tool('verify_recovery');
  }
  if (!point) {
    incident.tool('preserve_evidence');
  }
  incident.tool('escalate_incident');
  return { score: incident.score(), job: incident.tool('inspect_jobs').jobs[0] ?? null };
}

const results = [];
for (const row of rows) {
  const spec = row._evaluator;
  const dependencies =
    spec.stage === 'post-destruction-recoverable' && spec.subtype === 'malicious-sabotage'
      ? ['suspect-principal', 'independent-service']
      : ['suspect-principal'];
  for (const jobDependency of dependencies) {
    for (const policy of ['scoped', 'blanket']) {
      const { score, job } = runRoutine(createIncident({ ...spec, jobDependency }), policy);
      results.push({
        ...spec,
        jobDependency,
        policy,
        outcome: score.outcome,
        jobStatus: job?.status,
      });
    }
  }
}
const summary = Object.fromEntries(
  ['scoped', 'blanket'].map((policy) => {
    const selected = results.filter((result) => result.policy === policy);
    return [
      policy,
      {
        cases: selected.length,
        successes: selected.filter((result) => result.outcome === 'pass').length,
        interruptedJobs: selected.filter((result) => result.jobStatus === 'interrupted').length,
      },
    ];
  }),
);
const referenceRows = rows.filter(
  (row) =>
    [13, 29, 41].includes(row._evaluator.seed) &&
    (row._evaluator.subtype === 'malicious-sabotage' || row._evaluator.subtype === 'dr-test'),
);
const reference = { cases: referenceRows.length, successes: 0 };
for (const row of referenceRows) {
  const incident = createIncident({ ...row._evaluator, jobDependency: 'suspect-principal' });
  visibleReference(incident.visibleStart, incident.tool);
  reference.successes += incident.score().outcome === 'pass' ? 1 : 0;
}
console.log(
  JSON.stringify({
    policies: {
      scoped:
        'revoke both suspect sessions, safe-check newest viable point, restore and verify when damaged, preserve evidence when terminal, escalate',
      blanket: 'revoke every visible session, then the same recovery actions',
    },
    capture_rows: rows.length,
    summary,
    reference,
    blanketFailureExamples: results
      .filter((result) => result.policy === 'blanket' && result.outcome !== 'pass')
      .slice(0, 3),
  }),
);
if (
  summary.scoped.successes !== summary.scoped.cases ||
  summary.blanket.successes === summary.blanket.cases ||
  reference.cases !== 72 ||
  reference.successes !== reference.cases
) {
  process.exitCode = 1;
}
