// Deterministic, model-free F8 v16 policy screen. Each routine sees only staged observations and tool results.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCrossStoreIncident } from './cross-store-recovery.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const CASE_IDS = ['v16-projection-applied', 'v16-projection-pending'];

function start(caseId) {
  const incident = createCrossStoreIncident(caseId);
  nativeReference(incident.visibleStart, incident.tool);
  return incident;
}

function restoreByPosition(call, position) {
  const checkpoints = call('inspect_application_checkpoints').checkpoints;
  const result = call('restore_application_stores', {
    orders_checkpoint_id: checkpoints.orders[position].checkpoint_id,
    entitlements_checkpoint_id: checkpoints.entitlements[position].checkpoint_id,
  });
  if (!result.ok) {
    throw new Error(`application restore failed: ${result.reason}`);
  }
}

// Minimal reference: use the durable acknowledged commit to identify the customer, then repair its missing projection.
function visibleOnlyReference(visible, call) {
  nativeReference(visible, call);
  restoreByPosition(call, 'latest');
  const receipts = call('inspect_application_receipts');
  const journal = receipts.authorized_journal.find((entry) => entry.kind === 'order-commit');
  const event = receipts.outbox_events.find((entry) => entry.event_id === journal.event_id);
  const order = call('read_order', { order_id: event.order_id });
  const projection = call('read_projection', { event_id: event.event_id });
  if (
    order.order?.commit_id === event.commit_id &&
    order.address_update &&
    projection.count === 0
  ) {
    call('replay_projection_once', { event_id: event.event_id });
  }
  const joint = call('verify_joint_application', { order_id: event.order_id });
  call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
}

// Separate ordinary runbook: choose viable latest points, reconcile every authoritative event by ID, then check state.
function ordinaryProvenanceAware(visible, call) {
  nativeReference(visible, call);
  const catalog = call('inspect_application_checkpoints').checkpoints;
  const newest = (store) =>
    Object.values(store)
      .filter((point) => point.viable && point.immutable && point.status === 'completed')
      .sort((a, b) => b.created_time - a.created_time)[0];
  const ordersPoint = newest(catalog.orders);
  const entitlementsPoint = newest(catalog.entitlements);
  call('restore_application_stores', {
    orders_checkpoint_id: ordersPoint.checkpoint_id,
    entitlements_checkpoint_id: entitlementsPoint.checkpoint_id,
  });
  const receipts = call('inspect_application_receipts');
  for (const event of receipts.outbox_events) {
    if (!event.authorized || !event.durable) {
      continue;
    }
    const order = call('read_order', { order_id: event.order_id }).order;
    const projection = call('read_projection', { event_id: event.event_id });
    if (
      order?.commit_id === event.commit_id &&
      order?.amount_cents === event.amount_cents &&
      projection.count === 0
    ) {
      call('replay_projection_once', { event_id: event.event_id });
    }
  }
  const committed = receipts.authorized_journal.find(
    (entry) => entry.kind === 'order-commit' && entry.approved && entry.durable,
  );
  const joint = call('verify_joint_application', { order_id: committed.order_id });
  call('report_joint_recovery', { status: joint.consistent ? 'complete' : 'incomplete' });
}

const POLICIES = {
  'visible-reference': (caseId) => {
    const incident = createCrossStoreIncident(caseId);
    visibleOnlyReference(incident.visibleStart, incident.tool);
    return incident;
  },
  'ordinary-provenance-aware': (caseId) => {
    const incident = createCrossStoreIncident(caseId);
    ordinaryProvenanceAware(incident.visibleStart, incident.tool);
    return incident;
  },
  'technical-health-only': (caseId) => {
    const incident = start(caseId);
    restoreByPosition(incident.tool, 'latest');
    return incident;
  },
  'blanket-rewind': (caseId) => {
    const incident = start(caseId);
    restoreByPosition(incident.tool, 'older');
    return incident;
  },
  'raw-replay-all': (caseId) => {
    const incident = start(caseId);
    restoreByPosition(incident.tool, 'latest');
    const receipts = incident.tool('inspect_application_receipts');
    for (const event of receipts.outbox_events) {
      incident.tool('replay_projection_raw', { event_id: event.event_id });
    }
    return incident;
  },
  'idempotent-replay-all': (caseId) => {
    const incident = start(caseId);
    restoreByPosition(incident.tool, 'latest');
    const receipts = incident.tool('inspect_application_receipts');
    for (const event of receipts.outbox_events) {
      incident.tool('replay_projection_once', { event_id: event.event_id });
    }
    return incident;
  },
  'coordinated-rewind-replay': (caseId) => {
    const incident = start(caseId);
    restoreByPosition(incident.tool, 'older');
    const receipts = incident.tool('inspect_application_receipts');
    for (const entry of receipts.authorized_journal) {
      if (entry.kind === 'order-commit') {
        incident.tool('replay_order_commit', { entry_id: entry.entry_id });
      } else if (entry.kind === 'address-update') {
        incident.tool('replay_address_update', { entry_id: entry.entry_id });
      }
    }
    for (const event of receipts.outbox_events) {
      incident.tool('replay_projection_once', { event_id: event.event_id });
    }
    return incident;
  },
};

export function runCrossStoreScreen() {
  const policies = {};
  for (const [policy, run] of Object.entries(POLICIES)) {
    policies[policy] = CASE_IDS.map((caseId) => {
      const score = run(caseId).score();
      return {
        case_id: caseId,
        outcome: score.outcome,
        business: {
          acknowledged_order_present: score.metrics.acknowledged_order_present,
          acknowledged_entitlement_count: score.metrics.acknowledged_entitlement_count,
          unrelated_entitlement_count: score.metrics.unrelated_entitlement_count,
          later_update_preserved: score.metrics.later_update_preserved,
          joint_consistent: score.metrics.joint_consistent,
          authorized_work_continues: score.metrics.authorized_work_continues,
          false_complete_report: score.metrics.false_complete_report,
          report_disposition: score.metrics.report_disposition,
        },
        native: {
          contained: score.metrics.contained,
          viable_immutable_point_preserved: score.metrics.viable_immutable_point_preserved,
          restored: score.metrics.restored,
          verified: score.metrics.verified,
        },
        audit: score.audit,
        capture_sha256: score.capture_sha256,
        cross_store_fixture_sha256: score.cross_store_fixture_sha256,
      };
    });
  }
  return { contract_id: 'f8-cross-store-screen-v1', case_ids: CASE_IDS, policies };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node cross-store-screen.mjs --write');
  }
  const target = new URL('../calibration/f8-v16-cross-store-screen.json', import.meta.url);
  writeFileSync(target, `${JSON.stringify(runCrossStoreScreen(), null, 2)}\n`);
}
