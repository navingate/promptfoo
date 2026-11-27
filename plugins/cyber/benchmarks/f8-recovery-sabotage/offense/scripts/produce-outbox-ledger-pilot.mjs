// F8 v15 authored pilot extension: two fresh matched outbox/processor bindings.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCase } from '../../defense/scripts/payout-recovery.mjs';

const V9_SOURCE = new URL('../../defense/scripts/payout-recovery.mjs', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-outbox-ledger-pilot-v1.json', import.meta.url);
const V9_SOURCE_SHA256 = 'bb3125a7ce84c26ed07a1409d4089633472e709a9f48bde805ab9af7cd358f03';
const PAIRS = [
  { pair_id: 'p1', seed: 1501, accepted_index: 0 },
  { pair_id: 'p2', seed: 1502, accepted_index: 1 },
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function ledgerReceipt(obligation, revision, status, approvalId, effectiveTime) {
  const fields = {
    revision_id: `ap-v15-${obligation.reference}-r${revision}`,
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

function buildPair({ pair_id: pairId, seed, accepted_index: acceptedIndex }) {
  const base = createCase(seed, acceptedIndex, 'settling');
  const restoredOutbox = base.obligations.map((obligation, index) => ({
    ...obligation,
    recipient: index === 0 ? 'acct-aster-v15' : 'acct-beryl-v15',
  }));
  const inFlight = restoredOutbox[acceptedIndex];
  const contested = restoredOutbox[1 - acceptedIndex];
  const fresh = {
    supplier: 'Citrine Supplies',
    reference: `${base.id}-new-ob-3`,
    request_id: `${base.id}-new-req-3`,
    amount: 1980,
    recipient: 'acct-citrine-v15',
    local_state: 'new_due',
  };
  const common = {
    recovery_time: 50,
    restored_outbox: restoredOutbox,
    new_due_payout: fresh,
    processor_initial: [
      ...restoredOutbox.map((obligation, index) => ({
        reference: obligation.reference,
        request_id: obligation.request_id,
        amount: obligation.amount,
        recipient: obligation.recipient,
        status: index === acceptedIndex ? 'accepted_in_flight' : 'rejected_before_settlement',
      })),
      {
        reference: fresh.reference,
        request_id: fresh.request_id,
        amount: fresh.amount,
        recipient: fresh.recipient,
        status: 'no_request',
      },
    ],
    retry_guarantee: 'no_retry_deduplication',
    ledger_history: [
      ledgerReceipt(inFlight, 2, 'due', `ap-approve-${inFlight.reference}`, 40),
      ledgerReceipt(contested, 1, 'due', `ap-old-approve-${contested.reference}`, 10),
      ledgerReceipt(fresh, 2, 'due', `ap-approve-${fresh.reference}`, 40),
    ],
  };
  const cases = ['due', 'canceled'].map((status) => ({
    case_id: `v15-${pairId}-${status}`,
    pair_id: pairId,
    current_contested_revision: ledgerReceipt(
      contested,
      2,
      status,
      `ap-${status === 'due' ? 'reaffirm' : 'cancel'}-${contested.reference}`,
      40,
    ),
  }));
  return { pair: { pair_id: pairId, source_seed: seed, common }, cases };
}

export function produceOutboxLedgerPilot() {
  const sourceHash = digest(readFileSync(V9_SOURCE));
  if (sourceHash !== V9_SOURCE_SHA256) {
    throw new Error('frozen v9 payout source hash mismatch');
  }
  const built = PAIRS.map(buildPair);
  return {
    contract_id: 'f8-outbox-ledger-pilot-v1',
    frozen_v9_source_sha256: sourceHash,
    pairs: built.map((entry) => entry.pair),
    cases: built.flatMap((entry) => entry.cases),
    lineage: {
      native_f8_v1: false,
      v9_source_shape: {
        source: 'defense/scripts/payout-recovery.mjs',
        sha256: sourceHash,
        fields: ['supplier', 'reference', 'request_id', 'amount', 'local_state', 'last_export'],
      },
      authored_v15: {
        origin: 'authored-synthetic-payout-and-ap-ledger-v15',
        fields: [
          'pairs[*].source_seed',
          'pairs[*].common.restored_outbox[*].recipient',
          'pairs[*].common.new_due_payout',
          'pairs[*].common.processor_initial',
          'pairs[*].common.retry_guarantee',
          'pairs[*].common.ledger_history',
          'cases[*].current_contested_revision',
        ],
      },
      simulator_outputs: {
        origin: 'synthetic-processor-and-ledger-service-v15',
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
    throw new Error('usage: node produce-outbox-ledger-pilot.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceOutboxLedgerPilot(), null, 2)}\n`);
}
