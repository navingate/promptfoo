import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runVisiblePolicy } from './mixed-losing-pilot-interface.mjs';

export const CASE_ORDER = ['v20-pilot-second-independent', 'v20-pilot-first-independent'];

export function visibleReceiptPolicy(_visible, call) {
  const writes = call('inspect_branch_writes');
  const receipts = writes.losing.map((entry) =>
    call('lookup_ack_receipt', { write_id: entry.write_id }),
  );
  if (receipts.some((row) => !row.authenticated)) {
    throw new Error('write-bound acknowledgment is unavailable');
  }
  const state = call('read_serving_state');
  const present = new Set(Object.values(state.orders).map((order) => order.operation_id));
  for (const row of receipts) {
    if (!present.has(row.receipt.operation_id)) {
      call('apply_branch_write', { write_id: row.receipt.write_id });
      present.add(row.receipt.operation_id);
    }
  }
  const verified = call('verify_customer_operations');
  call('report_reconciliation', { status: verified.reconciled ? 'complete' : 'incomplete' });
}

export function ordinaryReceiptPolicy(_visible, call) {
  const topology = call('inspect_branch_topology');
  if (
    topology.branches.some((branch) => branch.ancestor_sha256 !== topology.ancestor.content_sha256)
  ) {
    throw new Error('common branch ancestor is inconsistent');
  }
  const writes = call('inspect_branch_writes');
  const receipts = [...writes.serving, ...writes.losing]
    .filter((entry) => entry.kind === 'order')
    .map((entry) => {
      const lookup = call('lookup_ack_receipt', { write_id: entry.write_id });
      if (!lookup.authenticated || lookup.receipt.write_id !== entry.write_id) {
        throw new Error('write-bound acknowledgment is missing');
      }
      return lookup.receipt;
    });
  const state = call('read_serving_state');
  const present = new Set(Object.values(state.orders).map((order) => order.operation_id));
  for (const entry of writes.losing) {
    const receipt = receipts.find((row) => row.write_id === entry.write_id);
    if (!present.has(receipt.operation_id)) {
      call('apply_branch_write', { write_id: entry.write_id });
      present.add(receipt.operation_id);
    }
  }
  call('read_serving_state');
}

const POLICIES = {
  'visible-receipt-reference': visibleReceiptPolicy,
  'ordinary-receipt-reconcile': ordinaryReceiptPolicy,
  'verifier-first-first-write': (_visible, call) => {
    if (!call('verify_customer_operations').reconciled) {
      const first = call('inspect_branch_writes').losing[0];
      call('apply_branch_write', { write_id: first.write_id });
    }
  },
  'apply-all': (_visible, call) => {
    for (const entry of call('inspect_branch_writes').losing) {
      call('apply_branch_write', { write_id: entry.write_id });
    }
  },
  'apply-and-compensate': (_visible, call) => {
    for (const entry of call('inspect_branch_writes').losing) {
      const result = call('apply_branch_write', { write_id: entry.write_id });
      if (result.duplicate_operation_after_apply) {
        call('compensate_duplicate_write', { write_id: entry.write_id });
      }
    }
  },
  'skip-all': () => {},
  'pick-smallest-operation-id': (_visible, call) => {
    const writes = call('inspect_branch_writes').losing;
    const receipts = writes.map(
      (entry) => call('lookup_ack_receipt', { write_id: entry.write_id }).receipt,
    );
    const chosen = receipts.toSorted((a, b) => a.operation_id.localeCompare(b.operation_id))[0];
    call('apply_branch_write', { write_id: chosen.write_id });
  },
  'pick-largest-operation-id': (_visible, call) => {
    const writes = call('inspect_branch_writes').losing;
    const receipts = writes.map(
      (entry) => call('lookup_ack_receipt', { write_id: entry.write_id }).receipt,
    );
    const chosen = receipts.toSorted((a, b) => b.operation_id.localeCompare(a.operation_id))[0];
    call('apply_branch_write', { write_id: chosen.write_id });
  },
};

export function runMixedPilotScreen() {
  return {
    contract_id: 'f8-v20-mixed-losing-pilot-screen-v1',
    case_order: CASE_ORDER,
    policies: Object.fromEntries(
      Object.entries(POLICIES).map(([name, policy]) => [
        name,
        CASE_ORDER.map((caseId) => {
          const result = runVisiblePolicy(caseId, policy);
          return {
            case_id: caseId,
            outcome: result.score.outcome,
            metrics: result.score.metrics,
            actions: result.actions,
            audit: result.score.audit,
            fixture_sha256: result.score.mixed_fixture_sha256,
            capture_sha256: result.score.capture_sha256,
          };
        }),
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node mixed-losing-pilot-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v20-mixed-losing-pilot-screen.json', import.meta.url),
    `${JSON.stringify(runMixedPilotScreen(), null, 2)}\n`,
  );
}
