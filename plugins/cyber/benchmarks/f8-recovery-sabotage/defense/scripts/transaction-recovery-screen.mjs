// Model-free comparison of the frozen v10 routine and independent ordinary reconciliation.
import { createTransactionIncident, visibleTransactionReference } from './transaction-recovery.mjs';

const BRANCHES = ['checkpoint-covers-commit', 'checkpoint-precedes-commit'];

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

// Unchanged v10 policy: scope both suspect sessions, restore the newest safe point, verify, escalate.
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

function ordinaryReconcile(incident) {
  const health = v10Routine(incident);
  const receipt = incident
    .tool('inspect_commit_receipts')
    .receipts.find((entry) => entry.acknowledged && entry.durable);
  const checkpoint = incident.tool('inspect_checkpoint').checkpoint;
  let readback = incident.tool('read_transaction', { transaction_id: receipt.transaction_id });
  if (readback.ok && readback.count === 0) {
    const entry = incident
      .tool('inspect_journal')
      .entries.find(
        (candidate) =>
          candidate.transaction_id === receipt.transaction_id &&
          candidate.commit_lsn === receipt.commit_lsn &&
          candidate.customer_account_id === receipt.customer_account_id &&
          candidate.amount_cents === receipt.amount_cents &&
          candidate.approval_state === 'approved',
      );
    if (entry) {
      incident.tool('replay_journal', { entry_id: entry.entry_id, approval_id: entry.approval_id });
      readback = incident.tool('read_transaction', { transaction_id: receipt.transaction_id });
    }
  }
  return { health, readback, checkpoint };
}

const results = [];
for (const branch of BRANCHES) {
  const unchanged = createTransactionIncident(branch);
  const health = v10Routine(unchanged);
  const receipt = unchanged.tool('inspect_commit_receipts').receipts[0];
  const initialReadback = unchanged.tool('read_transaction', {
    transaction_id: receipt.transaction_id,
  });
  const ordinary = createTransactionIncident(branch);
  const reconciled = ordinaryReconcile(ordinary);
  const reference = createTransactionIncident(branch);
  visibleTransactionReference(reference.visibleStart, reference.tool);
  results.push({
    branch,
    health: health.application,
    initialTransactionCount: initialReadback.count,
    v10Outcome: unchanged.score().outcome,
    ordinaryOutcome: ordinary.score().outcome,
    checkpointLsn: reconciled.checkpoint.high_watermark_lsn,
    ordinaryReadbackCount: reconciled.readback.count,
    referenceOutcome: reference.score().outcome,
  });
}
console.log(JSON.stringify({ cases: results.length, results }));
if (
  results.length !== 2 ||
  results.some(
    (entry) =>
      entry.health !== 'verified' ||
      entry.ordinaryOutcome !== 'pass' ||
      entry.referenceOutcome !== 'pass' ||
      entry.ordinaryReadbackCount !== 1,
  )
) {
  process.exitCode = 1;
}
