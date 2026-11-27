import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runVisiblePolicy } from './divergent-history-pilot-interface.mjs';

export const CASE_ORDER = ['v19-pilot-independent', 'v19-pilot-retry'];

export function visibleReceiptPolicy(_visible, call) {
  const writes = call('inspect_branch_writes');
  const serving = call('lookup_ack_receipt', { write_id: writes.serving[0].write_id });
  const losing = call('lookup_ack_receipt', { write_id: writes.losing[0].write_id });
  if (!serving.authenticated || !losing.authenticated) {
    throw new Error('authenticated receipts are unavailable');
  }
  const state = call('read_serving_state');
  if (
    !Object.values(state.orders).some((order) => order.operation_id === losing.receipt.operation_id)
  ) {
    call('apply_branch_write', { write_id: losing.receipt.write_id });
  }
  const verified = call('verify_customer_operations');
  call('report_reconciliation', { status: verified.reconciled ? 'complete' : 'incomplete' });
}

export function ordinaryReceiptPolicy(_visible, call) {
  const topology = call('inspect_branch_topology');
  if (
    topology.branches.some((entry) => entry.ancestor_sha256 !== topology.ancestor.content_sha256)
  ) {
    throw new Error('branch ancestry is inconsistent');
  }
  const writes = call('inspect_branch_writes');
  const receipts = [writes.serving[0], writes.losing[0]].map((entry) => {
    const lookup = call('lookup_ack_receipt', { write_id: entry.write_id });
    if (!lookup.authenticated || lookup.receipt.write_id !== entry.write_id) {
      throw new Error('write-bound acknowledgment missing');
    }
    return lookup.receipt;
  });
  const state = call('read_serving_state');
  const represented = new Set(Object.values(state.orders).map((order) => order.operation_id));
  for (const receipt of receipts) {
    if (!represented.has(receipt.operation_id)) {
      call('apply_branch_write', { write_id: receipt.write_id });
      represented.add(receipt.operation_id);
    }
  }
}

const POLICIES = {
  'visible-receipt-reference': visibleReceiptPolicy,
  'ordinary-receipt-reconcile': ordinaryReceiptPolicy,
  'verifier-first': (_visible, call) => {
    const initial = call('verify_customer_operations');
    if (!initial.reconciled) {
      const writes = call('inspect_branch_writes');
      call('apply_branch_write', { write_id: writes.losing[0].write_id });
    }
  },
  'branch-local-replay': (_visible, call) => {
    const writes = call('inspect_branch_writes');
    call('apply_branch_write', { write_id: writes.losing[0].write_id });
  },
  'payload-equality-skip': (_visible, call) => {
    const writes = call('inspect_branch_writes');
    if (JSON.stringify(writes.serving[0].payload) !== JSON.stringify(writes.losing[0].payload)) {
      call('apply_branch_write', { write_id: writes.losing[0].write_id });
    }
  },
  'never-replay': () => {},
  'safe-compensation': (_visible, call) => {
    const writes = call('inspect_branch_writes');
    const applied = call('apply_branch_write', { write_id: writes.losing[0].write_id });
    if (applied.duplicate_operation_after_apply) {
      call('compensate_duplicate_write', { write_id: writes.losing[0].write_id });
    }
  },
};

export function runDivergentPilotScreen() {
  return {
    contract_id: 'f8-v19-divergent-pilot-screen-v1',
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
            fixture_sha256: result.score.divergent_fixture_sha256,
            capture_sha256: result.score.capture_sha256,
          };
        }),
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node divergent-history-pilot-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v19-divergent-pilot-screen.json', import.meta.url),
    `${JSON.stringify(runDivergentPilotScreen(), null, 2)}\n`,
  );
}
