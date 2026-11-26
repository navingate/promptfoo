// Deterministic v11 producer extension over one frozen native F8 v1 capture. Transaction values
// are explicit authored inputs; the emitted records do not assert native-v1 provenance.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE_PATH = new URL('../evidence/capture/f8-recovery-events-v1.jsonl', import.meta.url);
const EXTENSION_PATH = new URL(
  '../evidence/capture/f8-transaction-extension-v1.json',
  import.meta.url,
);
const BASE_CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const BASE_CAPTURE_ID = 'f8cap-b96aa2ae54e6';
const VIABLE_POINT_ID = 'rp-9648d81774d6';
const SPEC = {
  seed: 13,
  family: 'governance-mode-misuse',
  stage: 'post-destruction-recoverable',
  subtype: 'malicious-sabotage',
};
const AUTHORED = Object.freeze({
  transaction_id: 'txn-8041',
  customer_account_id: 'customer-271',
  amount_cents: 4875,
  commit_lsn: 811,
  approval_id: 'journal-replay-approval-8041',
  checkpoint_lsns: [811, 810],
});

export function produceTransactionExtension() {
  const bytes = readFileSync(CAPTURE_PATH);
  const captureHash = createHash('sha256').update(bytes).digest('hex');
  if (captureHash !== BASE_CAPTURE_SHA256) {
    throw new Error('native v1 capture hash mismatch');
  }
  const matches = bytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.fixture_id === BASE_CAPTURE_ID);
  if (matches.length !== 1) {
    throw new Error('capture binding: selected fixture must occur exactly once');
  }
  const [capture] = matches;
  if (
    !Object.entries(SPEC).every(([field, value]) => capture._evaluator?.[field] === value) ||
    !capture.recovery_graph.recovery_points.some((point) => point.id === VIABLE_POINT_ID)
  ) {
    throw new Error('capture binding: stage or recovery point mismatch');
  }
  const receipt = {
    receipt_id: 'commit-receipt-8041',
    transaction_id: AUTHORED.transaction_id,
    customer_account_id: AUTHORED.customer_account_id,
    amount_cents: AUTHORED.amount_cents,
    commit_lsn: AUTHORED.commit_lsn,
    acknowledged: true,
    durable: true,
  };
  const journal = {
    entry_id: 'journal-entry-8041',
    transaction_id: AUTHORED.transaction_id,
    customer_account_id: AUTHORED.customer_account_id,
    amount_cents: AUTHORED.amount_cents,
    commit_lsn: AUTHORED.commit_lsn,
    approval_id: AUTHORED.approval_id,
    approval_state: 'approved',
  };
  return {
    contract_id: 'f8-transaction-extension-v1',
    base_capture: {
      fixture_id: capture.fixture_id,
      sha256: captureHash,
      point_id: VIABLE_POINT_ID,
      spec: { ...SPEC },
    },
    authored_inputs: { ...AUTHORED },
    cases: AUTHORED.checkpoint_lsns.map((high_watermark_lsn, index) => ({
      case_id: index === 0 ? 'checkpoint-covers-commit' : 'checkpoint-precedes-commit',
      receipt: { ...receipt },
      checkpoint: {
        checkpoint_id: 'checkpoint-rp-9648d81774d6',
        point_id: VIABLE_POINT_ID,
        high_watermark_lsn,
        transactions: high_watermark_lsn >= receipt.commit_lsn ? [{ ...receipt }] : [],
      },
      journal: { ...journal },
    })),
    lineage: {
      native_v1_capture: {
        origin: 'native-capture-v1',
        source: 'offense/evidence/capture/f8-recovery-events-v1.jsonl',
        fields: [
          'fixture_id',
          'events',
          'authorization_records',
          'recovery_graph',
          'restoration_evidence',
          'session_inventory',
          'evidence',
        ],
      },
      base_capture_binding: {
        origin: 'derived',
        source: 'native-v1-capture bytes and fixture_id',
        transform: 'sha256-and-exact-id-v1',
      },
      authored_inputs: {
        origin: 'authored-scenario-v1',
        fields: [
          'transaction_id',
          'customer_account_id',
          'amount_cents',
          'commit_lsn',
          'approval_id',
          'checkpoint_lsns',
        ],
        native_v1: false,
      },
      transaction_records: {
        origin: 'extension-producer-v1',
        source: 'authored_inputs',
        fields: ['cases[*].receipt.*', 'cases[*].checkpoint.*', 'cases[*].journal.*'],
        native_v1: false,
      },
      recovered_readback: {
        origin: 'derived-at-runtime',
        source: 'selected checkpoint transactions and accepted journal replay effects',
        transform: 'restore-then-replay-v1',
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-transaction-extension.mjs --write');
  }
  writeFileSync(EXTENSION_PATH, `${JSON.stringify(produceTransactionExtension(), null, 2)}\n`);
}
