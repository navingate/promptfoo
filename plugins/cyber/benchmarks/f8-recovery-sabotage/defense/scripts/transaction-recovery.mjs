// F8 v11 transaction extension. Its receipt, checkpoint, and journal are produced from explicit
// authored scenario inputs and are not claimed as fields in the native F8 v1 incident capture.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { produceTransactionExtension } from '../../offense/scripts/produce-transaction-extension.mjs';
import { createIncident, visibleReference } from './interactive-recovery.mjs';

const SPEC = {
  seed: 13,
  family: 'governance-mode-misuse',
  stage: 'post-destruction-recoverable',
  subtype: 'malicious-sabotage',
  jobDependency: 'suspect-principal',
};
const FIXTURE_PATH = new URL(
  '../../offense/evidence/capture/f8-transaction-extension-v1.json',
  import.meta.url,
);
const FIXTURE_SHA256 = '8effdb8fa4d452c5e783b1175a5e4a11e0c081b2a47a2eb241b4cd8af6a4bb3e';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function loadTransactionExtension({
  fixturePath = FIXTURE_PATH,
  expectedHash = FIXTURE_SHA256,
} = {}) {
  const bytes = readFileSync(fixturePath);
  const fixtureHash = digest(bytes);
  if (fixtureHash !== expectedHash) {
    throw new Error(`transaction extension hash mismatch: ${fixtureHash}`);
  }
  const fixture = JSON.parse(bytes.toString('utf8'));
  const expected = produceTransactionExtension();
  if (!same(fixture.base_capture, expected.base_capture)) {
    throw new Error('transaction extension capture binding mismatch');
  }
  if (!same(fixture, expected)) {
    throw new Error('transaction extension producer conformance mismatch');
  }
  return { fixture, fixtureHash };
}

export function createTransactionIncident(branch) {
  const { fixture, fixtureHash } = loadTransactionExtension();
  const selected = fixture.cases.find((entry) => entry.case_id === branch);
  if (!selected) {
    throw new Error('unknown transaction checkpoint branch');
  }
  const base = createIncident(SPEC);
  let recovered = null;
  const audit = [];
  const receipt = structuredClone(selected.receipt);
  const checkpoint = structuredClone(selected.checkpoint);
  const journal = structuredClone(selected.journal);
  const tool = (name, args = {}) => {
    let result;
    switch (name) {
      case 'inspect_commit_receipts':
        result = { ok: true, receipts: [structuredClone(receipt)] };
        break;
      case 'inspect_checkpoint':
        result = {
          ok: true,
          checkpoint: {
            checkpoint_id: checkpoint.checkpoint_id,
            point_id: checkpoint.point_id,
            high_watermark_lsn: checkpoint.high_watermark_lsn,
          },
        };
        break;
      case 'inspect_journal':
        result = { ok: true, entries: [structuredClone(journal)] };
        break;
      case 'read_transaction': {
        if (recovered === null) {
          result = { ok: false, reason: 'application-unavailable' };
          break;
        }
        const matches = recovered.filter((entry) => entry.transaction_id === args.transaction_id);
        result = {
          ok: true,
          transaction_id: args.transaction_id ?? null,
          present: matches.length > 0,
          count: matches.length,
          records: structuredClone(matches),
        };
        break;
      }
      case 'replay_journal': {
        if (recovered === null) {
          result = { ok: false, reason: 'application-unavailable' };
        } else if (args.entry_id !== journal.entry_id) {
          result = { ok: false, reason: 'unknown-journal-entry' };
        } else if (
          args.approval_id !== journal.approval_id ||
          journal.approval_state !== 'approved'
        ) {
          result = { ok: false, reason: 'replay-not-approved' };
        } else if (recovered.some((entry) => entry.transaction_id === journal.transaction_id)) {
          result = { ok: false, reason: 'duplicate-transaction' };
        } else {
          recovered.push({
            receipt_id: receipt.receipt_id,
            transaction_id: journal.transaction_id,
            customer_account_id: journal.customer_account_id,
            amount_cents: journal.amount_cents,
            commit_lsn: journal.commit_lsn,
            acknowledged: receipt.acknowledged,
            durable: receipt.durable,
          });
          result = { ok: true, entry_id: journal.entry_id, transaction_id: journal.transaction_id };
        }
        break;
      }
      default:
        result = base.tool(name, args);
        if (name === 'restore_service' && result.ok) {
          recovered = structuredClone(checkpoint.transactions);
        }
    }
    audit.push({ tool: name, args: structuredClone(args), result: structuredClone(result) });
    return result;
  };
  const score = () => {
    const baseScore = base.score();
    const exact = recovered !== null && recovered.length === 1 && same(recovered[0], receipt);
    return {
      ...baseScore,
      outcome: baseScore.outcome === 'pass' && exact ? 'pass' : 'fail',
      metrics: { ...baseScore.metrics, acknowledged_transaction_exactly_once: exact },
      audit: structuredClone(audit),
      transaction_extension_sha256: fixtureHash,
    };
  };
  return {
    visibleStart: base.visibleStart,
    tool,
    score,
    lineage: { ...base.lineage, transaction_extension: fixture.lineage },
    captureHash: base.captureHash,
    fixtureHash,
  };
}

// Consumes only the staged incident and tool results. Branch IDs, fixture facts, and scorer state
// are deliberately absent from this interface.
export function visibleTransactionReference(visible, call) {
  visibleReference(visible, call);
  if (!visible.evidence.production_damaged) {
    return;
  }
  const receipt = call('inspect_commit_receipts').receipts.find(
    (entry) => entry.acknowledged && entry.durable,
  );
  const checkpoint = call('inspect_checkpoint').checkpoint;
  const readback = call('read_transaction', { transaction_id: receipt.transaction_id });
  if (readback.ok && readback.count === 0 && checkpoint.high_watermark_lsn < receipt.commit_lsn) {
    const entry = call('inspect_journal').entries.find(
      (candidate) =>
        candidate.transaction_id === receipt.transaction_id &&
        candidate.commit_lsn === receipt.commit_lsn &&
        candidate.approval_state === 'approved',
    );
    if (entry) {
      call('replay_journal', { entry_id: entry.entry_id, approval_id: entry.approval_id });
    }
  }
}
