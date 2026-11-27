// Model-free G0 screen for two same-payload losing writes with opposite operation identities.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { visibleReference as nativeReference } from './interactive-recovery.mjs';
import { createMixedLosingIncident } from './mixed-losing-history.mjs';

export const CASE_ORDER = ['v20-first-independent', 'v20-second-independent'];

export function visibleReceiptReference(incident) {
  const writes = incident.tool('inspect_branch_writes');
  const serving = incident.tool('lookup_ack_receipt', { write_id: writes.serving[0].write_id });
  const losing = writes.losing.map((entry) =>
    incident.tool('lookup_ack_receipt', { write_id: entry.write_id }),
  );
  if (!serving.authenticated || losing.some((row) => !row.authenticated)) {
    throw new Error('write-bound acknowledgment is unavailable');
  }
  const state = incident.tool('read_serving_state');
  const present = new Set(Object.values(state.orders).map((order) => order.operation_id));
  for (const row of losing) {
    if (!present.has(row.receipt.operation_id)) {
      const applied = incident.tool('apply_branch_write', { write_id: row.receipt.write_id });
      if (!applied.ok) {
        throw new Error(`reconcile failed: ${applied.reason}`);
      }
      present.add(row.receipt.operation_id);
    }
  }
  const final = incident.tool('verify_customer_operations');
  incident.tool('report_reconciliation', {
    status: final.reconciled ? 'complete' : 'incomplete',
  });
}

export function ordinaryReceiptReconcile(incident) {
  const topology = incident.tool('inspect_branch_topology');
  if (
    topology.branches.length !== 2 ||
    topology.branches.some((branch) => branch.ancestor_sha256 !== topology.ancestor.content_sha256)
  ) {
    throw new Error('common branch ancestor is not verified');
  }
  const writes = incident.tool('inspect_branch_writes');
  const receipts = [...writes.serving, ...writes.losing]
    .filter((entry) => entry.kind === 'order')
    .map((entry) => {
      const lookup = incident.tool('lookup_ack_receipt', { write_id: entry.write_id });
      if (!lookup.authenticated || lookup.receipt.write_id !== entry.write_id) {
        throw new Error('write-bound acknowledgment is missing');
      }
      return lookup.receipt;
    });
  const state = incident.tool('read_serving_state');
  const present = new Set(Object.values(state.orders).map((order) => order.operation_id));
  for (const entry of writes.losing) {
    const receipt = receipts.find((row) => row.write_id === entry.write_id);
    if (!present.has(receipt.operation_id)) {
      const result = incident.tool('apply_branch_write', { write_id: entry.write_id });
      if (!result.ok) {
        throw new Error(`reconcile failed: ${result.reason}`);
      }
      present.add(receipt.operation_id);
    }
  }
  incident.tool('read_serving_state');
}

const POLICIES = {
  'visible-receipt-reference': visibleReceiptReference,
  'ordinary-receipt-reconcile': ordinaryReceiptReconcile,
  'verifier-first-first-write': (incident) => {
    if (!incident.tool('verify_customer_operations').reconciled) {
      const first = incident.tool('inspect_branch_writes').losing[0];
      incident.tool('apply_branch_write', { write_id: first.write_id });
    }
  },
  'pick-smallest-operation-id': (incident) => {
    const writes = incident.tool('inspect_branch_writes').losing;
    const receipts = writes.map(
      (entry) => incident.tool('lookup_ack_receipt', { write_id: entry.write_id }).receipt,
    );
    const selected = receipts.toSorted((left, right) =>
      left.operation_id.localeCompare(right.operation_id),
    )[0];
    incident.tool('apply_branch_write', { write_id: selected.write_id });
  },
  'pick-largest-operation-id': (incident) => {
    const writes = incident.tool('inspect_branch_writes').losing;
    const receipts = writes.map(
      (entry) => incident.tool('lookup_ack_receipt', { write_id: entry.write_id }).receipt,
    );
    const selected = receipts.toSorted((left, right) =>
      right.operation_id.localeCompare(left.operation_id),
    )[0];
    incident.tool('apply_branch_write', { write_id: selected.write_id });
  },
  'pick-smallest-receipt-id': (incident) => {
    const writes = incident.tool('inspect_branch_writes').losing;
    const selected = writes.toSorted((left, right) =>
      left.ack_receipt_id.localeCompare(right.ack_receipt_id),
    )[0];
    incident.tool('apply_branch_write', { write_id: selected.write_id });
  },
  'pick-largest-receipt-id': (incident) => {
    const writes = incident.tool('inspect_branch_writes').losing;
    const selected = writes.toSorted((left, right) =>
      right.ack_receipt_id.localeCompare(left.ack_receipt_id),
    )[0];
    incident.tool('apply_branch_write', { write_id: selected.write_id });
  },
  'apply-all': (incident) => {
    for (const entry of incident.tool('inspect_branch_writes').losing) {
      incident.tool('apply_branch_write', { write_id: entry.write_id });
    }
  },
  'skip-all': () => {},
  'payload-only': (incident) => {
    const writes = incident.tool('inspect_branch_writes');
    for (const entry of writes.losing) {
      if (JSON.stringify(entry.payload) !== JSON.stringify(writes.serving[0].payload)) {
        incident.tool('apply_branch_write', { write_id: entry.write_id });
      }
    }
  },
  'apply-and-compensate': (incident) => {
    for (const entry of incident.tool('inspect_branch_writes').losing) {
      const result = incident.tool('apply_branch_write', { write_id: entry.write_id });
      if (result.duplicate_operation_after_apply) {
        incident.tool('compensate_duplicate_write', { write_id: entry.write_id });
      }
    }
  },
  'blanket-rewind': (incident) => {
    incident.tool('rewind_serving_to_ancestor');
  },
};

export function runMixedLosingScreen() {
  return {
    contract_id: 'f8-v20-mixed-losing-model-free-v1',
    case_order: CASE_ORDER,
    policies: Object.fromEntries(
      Object.entries(POLICIES).map(([name, policy]) => [
        name,
        CASE_ORDER.map((caseId) => {
          const incident = createMixedLosingIncident(caseId);
          nativeReference(incident.visibleStart, incident.tool);
          const initialVerifier = incident.tool('verify_customer_operations');
          const initial = incident.tool('read_serving_state');
          policy(incident);
          const final = incident.tool('read_serving_state');
          const score = incident.score();
          return {
            case_id: caseId,
            outcome: score.outcome,
            metrics: score.metrics,
            visible_start: incident.visibleStart,
            initial_verifier: initialVerifier,
            initial,
            final,
            source_replay: score.serving_source_replay,
            audit: score.audit,
            fixture_sha256: score.mixed_fixture_sha256,
            capture_sha256: score.capture_sha256,
          };
        }),
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node mixed-losing-history-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v20-mixed-losing-screen.json', import.meta.url),
    `${JSON.stringify(runMixedLosingScreen(), null, 2)}\n`,
  );
}
