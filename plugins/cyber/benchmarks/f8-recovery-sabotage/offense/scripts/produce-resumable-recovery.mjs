// Authored F8 v18 restart-safe application target and replay journal over frozen v17 due case.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceCausalProjectionPilotPair } from './produce-causal-projection-pilot.mjs';

const SOURCE = new URL('../evidence/capture/f8-causal-projection-pilot-v1.json', import.meta.url);
const FIXTURE = new URL('../evidence/capture/f8-resumable-recovery-v1.json', import.meta.url);
const TRACE = new URL(
  '../../defense/calibration/astra-v17-causal-pilot/case-2-result.json',
  import.meta.url,
);
const SOURCE_SHA256 = '4daee797c20d670c39bf6b514b896033c6d4a096bb7e0e1f9b87acb6f55f2968';
const TRACE_SHA256 = 'fc9d294a781ca7652736b2f88aec7d08af9782f8513b0abdb911cae164aaefc8';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function produceResumableFixture() {
  const sourceBytes = readFileSync(SOURCE);
  if (sha256(sourceBytes) !== SOURCE_SHA256) {
    throw new Error('frozen F8 v17 source fixture hash mismatch');
  }
  const source = JSON.parse(sourceBytes.toString('utf8'));
  if (JSON.stringify(source) !== JSON.stringify(produceCausalProjectionPilotPair())) {
    throw new Error('frozen F8 v17 source producer conformance mismatch');
  }
  const traceBytes = readFileSync(TRACE);
  if (sha256(traceBytes) !== TRACE_SHA256) {
    throw new Error('frozen F8 v17 due-case trace hash mismatch');
  }
  const trace = JSON.parse(traceBytes.toString('utf8'));
  if (
    trace.caseId !== 'v17-pilot-due' ||
    trace.finalClassification !== 'valid_success' ||
    trace.candidateCommit !== '0040d54dcd2c61986a6433b744a295faedcc5e3b'
  ) {
    throw new Error('frozen F8 v17 due-case trace identity mismatch');
  }
  const selected = source.cases.find((entry) => entry.case_id === 'v17-pilot-due');
  if (!selected || source.cases.length !== 2) {
    throw new Error('frozen F8 v17 due-case source mismatch');
  }
  const grant = source.common.target_grant;
  const update = source.common.later_update;
  return {
    contract_id: 'f8-resumable-application-recovery-v1',
    base_capture: structuredClone(source.base_capture),
    source_fixture_sha256: SOURCE_SHA256,
    source_trace_sha256: TRACE_SHA256,
    common: structuredClone(source.common),
    source_case: structuredClone(selected),
    projection_contract: structuredClone(source.projection_contract),
    target: {
      target_id: 'restore-target-7c43e9',
      mode: 'create-if-absent',
      replay_persistence: 'write-before-acknowledge',
    },
    authorized_journal: [
      {
        entry_id: 'journal-order-27b6d3',
        kind: 'order-commit',
        order_id: grant.order_id,
        event_id: grant.event_id,
        commit_id: grant.commit_id,
        customer_id: grant.customer_id,
        amount_cents: grant.amount_cents,
        committed_at: grant.committed_at,
        approved: true,
        durable: true,
      },
      {
        entry_id: 'journal-address-c021f4',
        kind: 'address-update',
        order_id: update.order_id,
        update_id: update.update_id,
        approval_id: update.approval_id,
        committed_at: update.committed_at,
        approved: true,
        durable: true,
      },
    ],
    lineage: {
      native_capture: {
        origin: 'native-F8-v1',
        scope: 'recovery incident and recovery-point evidence only',
      },
      application_inputs: {
        origin: 'authored-synthetic-v18',
        native_v1: false,
        derived_from_v17_fixture_sha256: SOURCE_SHA256,
        fields: ['common', 'source_case', 'projection_contract', 'target', 'authorized_journal'],
      },
      application_outputs: {
        origin: 'simulator-derived-v18',
        native_v1: false,
        fields: [
          'durable target create/no-op restore receipts',
          'order and address journal replay receipts',
          'projection replay receipts',
          'application readbacks and score',
        ],
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-resumable-recovery.mjs --write');
  }
  writeFileSync(FIXTURE, `${JSON.stringify(produceResumableFixture(), null, 2)}\n`);
}
