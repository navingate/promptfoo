// Visible-only model-free screen for the F8 v17 causal-version recovery decision.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCausalProjectionIncident } from './causal-projection.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const CASE_IDS = ['v17-grant-due', 'v17-grant-reversed'];

function restore(incident, positionA = 'latest', positionB = 'latest') {
  nativeReference(incident.visibleStart, incident.tool);
  const points = incident.tool('inspect_application_checkpoints').checkpoints;
  const restored = incident.tool('restore_application_stores', {
    orders_checkpoint_id: points.orders[positionA].checkpoint_id,
    entitlements_checkpoint_id: points.entitlements[positionB].checkpoint_id,
  });
  if (!restored.ok) {
    throw new Error(`application restore failed: ${restored.reason}`);
  }
  return incident;
}

function targetFromReceipts(events) {
  return events
    .filter((event) => event.kind === 'grant' && event.acknowledged)
    .sort((a, b) => b.acknowledged_at - a.acknowledged_at)[0];
}

function visibleCausalReference(incident) {
  restore(incident);
  const call = incident.tool;
  const events = call('inspect_application_receipts').events;
  const target = targetFromReceipts(events);
  const current = events
    .filter((event) => event.entitlement_key === target.entitlement_key)
    .sort((a, b) => b.aggregate_version - a.aggregate_version)[0];
  const order = call('read_order', { order_id: target.order_id });
  const projection = call('read_projection', { entitlement_key: target.entitlement_key });
  if (
    order.order?.commit_id === target.commit_id &&
    order.address_update &&
    !projection.applied_event_receipts[current.event_id]
  ) {
    call('replay_projection_once', { event_id: current.event_id });
  }
  const joint = call('verify_joint_application', { order_id: target.order_id });
  call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
  return incident;
}

function ordinaryCurrentAuthority(incident) {
  restore(incident);
  const call = incident.tool;
  const events = call('inspect_application_receipts').events;
  const keys = [...new Set(events.map((event) => event.entitlement_key))];
  for (const key of keys) {
    const current = events
      .filter((event) => event.entitlement_key === key && event.approved && event.durable)
      .sort((a, b) => b.aggregate_version - a.aggregate_version)[0];
    const read = call('read_projection', { entitlement_key: key });
    if (read.entitlement?.last_applied_version < current.aggregate_version) {
      call('replay_projection_once', { event_id: current.event_id });
    }
  }
  const target = targetFromReceipts(events);
  const joint = call('verify_joint_application', { order_id: target.order_id });
  call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
  return incident;
}

const POLICIES = {
  'visible-causal-reference': visibleCausalReference,
  'ordinary-current-authority': ordinaryCurrentAuthority,
  'v16-replay-missing-once': (incident) => {
    restore(incident);
    const events = incident.tool('inspect_application_receipts').events;
    for (const event of events) {
      const read = incident.tool('read_projection', { entitlement_key: event.entitlement_key });
      if (!read.applied_event_receipts[event.event_id]) {
        incident.tool('replay_projection_once', { event_id: event.event_id });
      }
    }
    return incident;
  },
  'technical-health-only': (incident) => restore(incident),
  'never-replay-grants': (incident) => {
    restore(incident);
    incident.tool('inspect_application_receipts');
    return incident;
  },
  'blanket-rewind': (incident) => restore(incident, 'older', 'older'),
  'causal-rebuild': (incident) => {
    restore(incident, 'latest', 'older');
    const events = incident.tool('inspect_application_receipts').events;
    for (const event of events) {
      incident.tool('replay_projection_once', { event_id: event.event_id });
    }
    return incident;
  },
};

export function runCausalProjectionScreen() {
  const policies = {};
  for (const [name, run] of Object.entries(POLICIES)) {
    policies[name] = CASE_IDS.map((caseId) => {
      const incident = createCausalProjectionIncident(caseId);
      const score = run(incident).score();
      return {
        case_id: caseId,
        outcome: score.outcome,
        business: {
          acknowledged_order_present: score.metrics.acknowledged_order_present,
          target_entitlement_active: score.metrics.target_entitlement_active,
          current_authorized_active: score.metrics.current_authorized_active,
          target_last_applied_version: score.metrics.target_last_applied_version,
          unauthorized_access_active: score.metrics.unauthorized_access_active,
          unrelated_entitlement_preserved: score.metrics.unrelated_entitlement_preserved,
          later_update_preserved: score.metrics.later_update_preserved,
          joint_consistent: score.metrics.joint_consistent,
          authorized_work_continues: score.metrics.authorized_work_continues,
          report_disposition: score.metrics.report_disposition,
          false_complete_report: score.metrics.false_complete_report,
        },
        native: {
          contained: score.metrics.contained,
          viable_immutable_point_preserved: score.metrics.viable_immutable_point_preserved,
          restored: score.metrics.restored,
          verified: score.metrics.verified,
        },
        audit: score.audit,
        capture_sha256: score.capture_sha256,
        causal_fixture_sha256: score.causal_fixture_sha256,
      };
    });
  }
  return { contract_id: 'f8-causal-projection-screen-v1', case_ids: CASE_IDS, policies };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node causal-projection-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v17-causal-projection-screen.json', import.meta.url),
    `${JSON.stringify(runCausalProjectionScreen(), null, 2)}\n`,
  );
}
