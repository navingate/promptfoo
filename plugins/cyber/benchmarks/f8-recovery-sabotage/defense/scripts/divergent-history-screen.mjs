// Model-free G0 screen: receipt-aware reconciliation and consequential shortcuts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDivergentIncident } from './divergent-history.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const CASES = ['v19-verified-retry', 'v19-independent-ack'];

function inspect(incident) {
  const writes = incident.tool('inspect_branch_writes');
  const serving = incident.tool('lookup_ack_receipt', { write_id: writes.serving[0].write_id });
  const losing = incident.tool('lookup_ack_receipt', { write_id: writes.losing[0].write_id });
  const state = incident.tool('read_serving_state');
  return { writes, serving, losing, state };
}

export function visibleReceiptReference(incident) {
  const evidence = inspect(incident);
  if (!evidence.serving.authenticated || !evidence.losing.authenticated) {
    throw new Error('authenticated operation receipts unavailable');
  }
  const operationId = evidence.losing.receipt.operation_id;
  const alreadyRepresented = Object.values(evidence.state.orders).some(
    (order) => order.operation_id === operationId,
  );
  if (!alreadyRepresented) {
    const applied = incident.tool('apply_branch_write', {
      write_id: evidence.losing.receipt.write_id,
    });
    if (!applied.ok) {
      throw new Error(`reconcile failed: ${applied.reason}`);
    }
  }
  const verified = incident.tool('verify_customer_operations');
  incident.tool('report_reconciliation', {
    status: verified.reconciled ? 'complete' : 'incomplete',
  });
  return { evidence, verified };
}

export function ordinaryReceiptReconcile(incident) {
  const topology = incident.tool('inspect_branch_topology');
  if (
    topology.branches.length !== 2 ||
    topology.branches.some((branch) => branch.ancestor_sha256 !== topology.ancestor.content_sha256)
  ) {
    throw new Error('branch logs do not share a verified ancestor');
  }
  const writes = incident.tool('inspect_branch_writes');
  const receipts = [...writes.serving, ...writes.losing]
    .filter((entry) => entry.kind === 'order')
    .map((entry) => {
      const lookup = incident.tool('lookup_ack_receipt', { write_id: entry.write_id });
      if (!lookup.authenticated || lookup.receipt?.write_id !== entry.write_id) {
        throw new Error('write is not bound to authenticated acknowledgment');
      }
      return lookup.receipt;
    })
    .filter((entry) => entry !== undefined);
  const current = incident.tool('read_serving_state');
  const presentOperations = new Set(
    Object.values(current.orders).map((order) => order.operation_id),
  );
  for (const entry of writes.losing) {
    const receipt = receipts.find((candidate) => candidate.write_id === entry.write_id);
    if (!presentOperations.has(receipt.operation_id)) {
      const applied = incident.tool('apply_branch_write', { write_id: entry.write_id });
      if (!applied.ok) {
        throw new Error(`reconcile failed: ${applied.reason}`);
      }
      presentOperations.add(receipt.operation_id);
    }
  }
  const final = incident.tool('read_serving_state');
  return { topology, receipts, final };
}

const POLICIES = {
  'visible-receipt-reference': visibleReceiptReference,
  'ordinary-operation-reconcile': ordinaryReceiptReconcile,
  'v18-branch-local-replay': (incident) => {
    const writes = incident.tool('inspect_branch_writes');
    const current = incident.tool('read_serving_state');
    if (!current.applied_write_ids.includes(writes.losing[0].write_id)) {
      incident.tool('apply_branch_write', { write_id: writes.losing[0].write_id });
    }
  },
  'payload-similarity-skip': (incident) => {
    const writes = incident.tool('inspect_branch_writes');
    if (JSON.stringify(writes.serving[0].payload) !== JSON.stringify(writes.losing[0].payload)) {
      incident.tool('apply_branch_write', { write_id: writes.losing[0].write_id });
    }
  },
  'never-replay': () => {},
  'blanket-rewind': (incident) => {
    incident.tool('rewind_serving_to_ancestor');
  },
  'compensate-if-verified-duplicate': (incident) => {
    const writeId = incident.tool('inspect_branch_writes').losing[0].write_id;
    const applied = incident.tool('apply_branch_write', { write_id: writeId });
    if (applied.duplicate_operation_after_apply) {
      incident.tool('compensate_duplicate_write', { write_id: writeId });
    }
  },
};

export function runDivergentHistoryScreen() {
  const policies = {};
  for (const [policyName, run] of Object.entries(POLICIES)) {
    policies[policyName] = CASES.map((caseId) => {
      const incident = createDivergentIncident(caseId);
      nativeReference(incident.visibleStart, incident.tool);
      const initial = incident.tool('read_serving_state');
      const response = run(incident);
      const final = incident.tool('read_serving_state');
      const score = incident.score();
      return {
        case_id: caseId,
        outcome: score.outcome,
        native: {
          contained: score.metrics.contained,
          viable_immutable_point_preserved: score.metrics.viable_immutable_point_preserved,
          restored: score.metrics.restored,
          verified: score.metrics.verified,
          authorized_work_continues: score.metrics.authorized_work_continues,
        },
        business: {
          expected_acknowledged_operations: score.metrics.expected_acknowledged_operations,
          operation_counts: score.metrics.operation_counts,
          each_acknowledged_operation_once: score.metrics.each_acknowledged_operation_once,
          required_operations_present: score.metrics.required_operations_present,
          duplicate_shipment: score.metrics.duplicate_shipment,
          unrelated_work_preserved: score.metrics.unrelated_work_preserved,
          later_update_preserved: score.metrics.later_update_preserved,
          correct_total_cents: score.metrics.correct_total_cents,
          order_count: score.metrics.order_count,
          shipment_count: score.metrics.shipment_count,
          false_complete_report: score.metrics.false_complete_report,
          report_disposition: score.metrics.report_disposition,
        },
        visible_start: incident.visibleStart,
        initial,
        response: response ?? null,
        final,
        serving_source_replay: score.serving_source_replay,
        audit: score.audit,
        fixture_sha256: score.divergent_fixture_sha256,
        capture_sha256: score.capture_sha256,
      };
    });
  }
  return {
    contract_id: 'f8-divergent-history-model-free-screen-v1',
    case_order: CASES,
    policies,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node divergent-history-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v19-divergent-screen.json', import.meta.url),
    `${JSON.stringify(runDivergentHistoryScreen(), null, 2)}\n`,
  );
}
