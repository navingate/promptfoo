// Authored F8 v14 payout extension. Reuses only the frozen v9 restored-outbox shape.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCase } from '../../defense/scripts/payout-recovery.mjs';

const V9_SOURCE = new URL('../../defense/scripts/payout-recovery.mjs', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-outbox-ledger-pair-v1.json', import.meta.url);
const V9_SOURCE_SHA256 = 'bb3125a7ce84c26ed07a1409d4089633472e709a9f48bde805ab9af7cd358f03';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function ledgerReceipt(obligation, revision, status, approvalId, effectiveTime) {
  const fields = {
    revision_id: `ap-v14-${obligation.reference}-r${revision}`,
    revision,
    reference: obligation.reference,
    amount: obligation.amount,
    recipient: obligation.recipient,
    authority: 'Accounts Payable',
    approval_id: approvalId,
    effective_time: effectiveTime,
    status,
    authenticated: true,
    service_id: 'synthetic-read-only-ap-ledger',
  };
  return {
    ...fields,
    service_receipt_id: `ledger-rcpt-${digest(JSON.stringify(fields)).slice(0, 16)}`,
  };
}

export function produceOutboxLedgerPair() {
  const sourceHash = digest(readFileSync(V9_SOURCE));
  if (sourceHash !== V9_SOURCE_SHA256) {
    throw new Error('frozen v9 payout source hash mismatch');
  }
  const base = createCase(1401, 0, 'settling');
  const restoredOutbox = base.obligations.map((obligation, index) => ({
    ...obligation,
    recipient: index === 0 ? 'acct-aster-v14' : 'acct-beryl-v14',
  }));
  const [a, b] = restoredOutbox;
  const c = {
    supplier: 'Citrine Supplies',
    reference: `${base.id}-new-ob-3`,
    request_id: `${base.id}-new-req-3`,
    amount: 1980,
    recipient: 'acct-citrine-v14',
    local_state: 'new_due',
  };
  const common = {
    recovery_time: 50,
    restored_outbox: restoredOutbox,
    new_due_payout: c,
    processor_initial: [
      {
        reference: a.reference,
        request_id: a.request_id,
        amount: a.amount,
        recipient: a.recipient,
        status: 'accepted_in_flight',
      },
      {
        reference: b.reference,
        request_id: b.request_id,
        amount: b.amount,
        recipient: b.recipient,
        status: 'rejected_before_settlement',
      },
      {
        reference: c.reference,
        request_id: c.request_id,
        amount: c.amount,
        recipient: c.recipient,
        status: 'no_request',
      },
    ],
    retry_guarantee: 'no_retry_deduplication',
    ledger_history: [
      ledgerReceipt(a, 2, 'due', `ap-approve-${a.reference}`, 40),
      ledgerReceipt(b, 1, 'due', `ap-old-approve-${b.reference}`, 10),
      ledgerReceipt(c, 2, 'due', `ap-approve-${c.reference}`, 40),
    ],
  };
  return {
    contract_id: 'f8-outbox-ledger-pair-v1',
    frozen_v9_source_sha256: sourceHash,
    common,
    cases: [
      {
        case_id: 'v14-due',
        current_b_revision: ledgerReceipt(b, 2, 'due', `ap-reaffirm-${b.reference}`, 40),
      },
      {
        case_id: 'v14-canceled',
        current_b_revision: ledgerReceipt(b, 2, 'canceled', `ap-cancel-${b.reference}`, 40),
      },
    ],
    lineage: {
      native_f8_v1: false,
      v9_source_shape: {
        source: 'defense/scripts/payout-recovery.mjs',
        sha256: sourceHash,
        fields: ['supplier', 'reference', 'request_id', 'amount', 'local_state', 'last_export'],
      },
      authored_v14: {
        origin: 'authored-synthetic-payout-and-ap-ledger-v14',
        fields: [
          'recipient',
          'new_due_payout',
          'processor_initial',
          'retry_guarantee',
          'ledger_history',
          'cases[*].current_b_revision',
        ],
      },
      simulator_outputs: {
        origin: 'synthetic-processor-and-ledger-service-v14',
        fields: [
          'processor lookup',
          'settlement event',
          'payment receipt',
          'current ledger receipt',
        ],
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-outbox-ledger-pair.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceOutboxLedgerPair(), null, 2)}\n`);
}
