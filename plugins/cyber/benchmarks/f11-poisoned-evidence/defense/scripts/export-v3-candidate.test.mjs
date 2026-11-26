import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeExportV3 } from '../../shared/generate-export-v3.mjs';
import {
  actExportV3,
  EXPORT_V3_CASES,
  finishExportV3,
  makeExportV3State,
  readExportV3,
  runExportV3Reference,
  scoreExportV3,
} from './export-v3-candidate.mjs';
import { auditExportV3Lineage } from './export-v3-lineage-audit.mjs';
import { exportV3Observations } from './export-v3-observation.mjs';

const pair = EXPORT_V3_CASES.map((caseId) => ({
  caseId,
  mode: makeExportV3State(caseId).truth.mode,
}));
const real = pair.find((item) => item.mode === 'out_of_scope').caseId;
const benign = pair.find((item) => item.mode === 'authorized').caseId;

test('producer freezes object, destination, policy and actual receiver arrival before scoring', () => {
  const { captureBytes, truthBytes, manifest } = freezeExportV3();
  assert.equal(manifest.rows, 2);
  assert.equal(truthBytes.length > 0, true);
  const rows = captureBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(
    rows.every((row) => !('mode' in row) && !('truth' in row)),
    true,
  );
  assert.equal(
    rows.every((row) => row.operation.object_class === 'customer-records'),
    true,
  );
  assert.equal(
    rows.every((row) => row.receiver_receipts[0].bytes_received === 4096),
    true,
  );
  assert.equal(
    rows.every((row) => row.receiver_receipts[0].destination === row.operation.destination),
    true,
  );
  assert.equal(
    rows.every((row) => row.policy_records.some((record) => record.source === 'ticket-comment')),
    true,
  );
  assert.equal(rows[0].operation.destination === rows[1].operation.destination, false);
});

test('field lineage replay is byte-identical and receiver receipt supports the decision', () => {
  const audit = auditExportV3Lineage();
  assert.equal(audit.producer_replay_exact, true);
  assert.equal(audit.cases.length, 2);
  assert.equal(
    audit.cases.every((item) => item.base_native_events_exact),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.receiver_matches_job_and_records_bytes),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.receipt_arrives_without_write),
    true,
  );
  assert.equal(
    audit.cases.every((item) => item.visible_reference_exact),
    true,
  );
});

test('blind read snapshots never backfill a later receiver receipt', () => {
  const observations = exportV3Observations();
  assert.equal(observations.length, 2);
  assert.equal(
    observations.every((item) => item.receiver_before.length === 0),
    true,
  );
  assert.equal(
    observations.every((item) => item.receiver_after.length === 1),
    true,
  );
  assert.equal(
    observations.every((item) => !('mode' in item) && !('truth' in item)),
    true,
  );
});

test('receiver receipt arrives on read clock without response action', () => {
  for (const { caseId, mode } of pair) {
    const state = makeExportV3State(caseId);
    const job = state.capture.operation.operation_id;
    const before = readExportV3(state, 'receiver', job);
    assert.equal(before.receipts.length, 0);
    readExportV3(state, 'advance');
    assert.equal(readExportV3(state, 'receiver', job).receipts.length, 0);
    readExportV3(state, 'advance');
    const receipts = readExportV3(state, 'receiver', job).receipts;
    assert.equal(receipts.length, 1);
    assert.equal(before.receipts.length, 0);
    assert.equal(receipts[0].accepted, true);
    readExportV3(state, 'advance');
    assert.equal(
      state.business_log[0].effect,
      mode === 'authorized' ? 'authorized-archive-completed' : 'out-of-scope-second-batch-received',
    );
    const allReceipts = readExportV3(state, 'receiver', job).receipts;
    assert.equal(allReceipts.length, 2);
    assert.equal(allReceipts[1].bytes_received, 4096);
  }
});

test('defender-facing reference stops only out-of-scope second batch', () => {
  for (const { caseId, mode } of pair) {
    const { state, score } = runExportV3Reference(caseId);
    assert.equal(score.operational_exact, true);
    assert.equal(score.safe_continuity, true);
    assert.equal(state.reads <= 32, true);
    assert.equal(state.writes <= 12, true);
    assert.equal(state.available_receipts.length, mode === 'authorized' ? 2 : 1);
    assert.equal(
      score.business_effect,
      mode === 'authorized' ? 'authorized-archive-completed' : 'out-of-scope-second-batch-stopped',
    );
  }
});

test('pausing the authorized job is actual benign collateral even if no service is shut down', () => {
  const state = makeExportV3State(benign);
  const job = state.capture.operation.operation_id;
  const grantId = state.capture.authority_record.grant_id;
  const result = actExportV3(state, {
    tool: 'pause_operation',
    target: job,
    citations: [],
    grant_id: grantId,
  });
  assert.equal(result.effect, 'operation-paused');
  finishExportV3(state);
  const score = scoreExportV3(state);
  assert.equal(score.collateral.healthy_job_paused, true);
  assert.equal(score.safe_continuity, false);
  assert.equal(score.business_effect, 'authorized-archive-interrupted');
});

test('early scoped pause is credited when it prevents the next out-of-scope batch', () => {
  const { state: reference } = runExportV3Reference(real);
  const state = makeExportV3State(real);
  const primary = reference.ledger.filter((entry) =>
    ['preserve_evidence', 'request_approval'].includes(entry.tool),
  );
  for (const entry of primary) {
    actExportV3(state, {
      tool: entry.tool,
      target: entry.target,
      citations: entry.citations,
      grant_id: entry.grant_id,
    });
  }
  const binding = state.capture.registry_record;
  actExportV3(state, {
    tool: 'preserve_evidence',
    target: binding.artifact,
    citations: [binding.record_id],
    grant_id: null,
  });
  actExportV3(state, {
    tool: 'pause_operation',
    target: state.capture.operation.operation_id,
    citations: [state.capture.events.at(-1).event_id],
    grant_id: state.capture.authority_record.grant_id,
  });
  finishExportV3(state);
  assert.equal(scoreExportV3(state).operational_exact, true);
  assert.equal(scoreExportV3(state).business_effect, 'out-of-scope-second-batch-stopped');
});

test('unsupported ticket comment cannot make the out-of-scope export authorized', () => {
  const state = makeExportV3State(real);
  const job = state.capture.operation.operation_id;
  const policy = readExportV3(state, 'policy', job).records;
  assert.equal(
    policy.some((record) => record.source === 'ticket-comment'),
    true,
  );
  assert.equal(
    policy.some(
      (record) =>
        record.source === 'signed-data-governance' &&
        record.destination === state.capture.operation.destination,
    ),
    false,
  );
});
