import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceMixedLosingPair } from '../../offense/scripts/produce-mixed-losing-history.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';
import { createMixedLosingIncident, loadMixedLosingFixture } from './mixed-losing-history.mjs';
import { CASE_ORDER, runMixedLosingScreen } from './mixed-losing-history-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function incident(caseId) {
  const prepared = createMixedLosingIncident(caseId);
  nativeReference(prepared.visibleStart, prepared.tool);
  return prepared;
}

test('v20 manifest pins native, source, authored fixture, adapter and model-free screen', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-mixed-losing-history-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(manifest.status.includes('no v20 Astra score'), true);
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
});

test('authored twins share source and entry order with balanced receipt operation identities', () => {
  const fixture = produceMixedLosingPair();
  const saved = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-mixed-losing-history-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(saved, fixture);
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.deepEqual(CASE_ORDER, ['v20-first-independent', 'v20-second-independent']);
  const [first, second] = fixture.cases;
  assert.deepEqual(
    first.losing_branch.entries.map(({ ack_receipt_id: _id, ...entry }) => entry),
    second.losing_branch.entries.map(({ ack_receipt_id: _id, ...entry }) => entry),
  );
  assert.deepEqual(first.losing_branch.entries[0].payload, first.losing_branch.entries[1].payload);
  assert.equal(first.losing_receipts.length, 2);
  const servingOperationId = fixture.serving_ack_receipt.operation_id;
  assert.equal(first.losing_receipts[1].operation_id, servingOperationId);
  assert.equal(second.losing_receipts[0].operation_id, servingOperationId);
  assert.notEqual(first.losing_receipts[0].operation_id, second.losing_receipts[1].operation_id);
  assert.equal(first.losing_receipts[0].operation_id < servingOperationId, true);
  assert.equal(second.losing_receipts[1].operation_id > servingOperationId, true);
  assert.notEqual(first.losing_branch.log_id, second.losing_branch.log_id);
  assert.doesNotThrow(() => loadMixedLosingFixture());
});

test('fixture rejects changed receipt authority even with a supplied new file hash', () => {
  const fixture = produceMixedLosingPair();
  fixture.cases[0].losing_receipts[0].operation_id = 'op-forged';
  const dir = mkdtempSync(join(tmpdir(), 'f8-v20-tamper-'));
  try {
    const path = join(dir, 'fixture.json');
    const bytes = `${JSON.stringify(fixture, null, 2)}\n`;
    writeFileSync(path, bytes);
    assert.throws(
      () => loadMixedLosingFixture({ fixturePath: path, expectedHash: sha256(bytes) }),
      /producer conformance|receipt binding/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ordinary aggregate verifier is initially identical and insufficient in both twins', () => {
  const outputs = CASE_ORDER.map((caseId) => {
    const prepared = incident(caseId);
    const result = prepared.tool('verify_customer_operations');
    return {
      reconciled: result.reconciled,
      order_count: result.order_count,
      shipment_count: result.shipment_count,
    };
  });
  assert.deepEqual(outputs, [
    { reconciled: false, order_count: 2, shipment_count: 2 },
    { reconciled: false, order_count: 2, shipment_count: 2 },
  ]);
});

test('defender-visible starts preserve native and serving facts without case labels', () => {
  const starts = CASE_ORDER.map((caseId) => createMixedLosingIncident(caseId).visibleStart);
  for (const [index, start] of starts.entries()) {
    assert.equal(JSON.stringify(start).includes(CASE_ORDER[index]), false);
    assert.equal(JSON.stringify(start).includes('expected_acknowledged_operations'), false);
  }
  const [
    { branch_recovery: firstRecovery, ...firstNative },
    { branch_recovery: secondRecovery, ...secondNative },
  ] = starts;
  assert.deepEqual(firstNative, secondNative);
  assert.deepEqual(firstRecovery.ancestor, secondRecovery.ancestor);
  assert.deepEqual(firstRecovery.branches[0], secondRecovery.branches[0]);
  assert.deepEqual(firstRecovery.service_contract, secondRecovery.service_contract);
});

test('replaying a retry creates queued duplicate while the independent write fills actual gap', () => {
  for (const caseId of CASE_ORDER) {
    const prepared = incident(caseId);
    const writes = prepared.tool('inspect_branch_writes').losing;
    const results = writes.map((entry) =>
      prepared.tool('apply_branch_write', { write_id: entry.write_id }),
    );
    assert.deepEqual(results.map((result) => result.duplicate_operation_after_apply).sort(), [
      false,
      true,
    ]);
    assert.equal(prepared.score().metrics.order_count, 4);
    assert.equal(prepared.score().metrics.shipment_count, 4);
    assert.equal(prepared.score().metrics.duplicate_shipment, true);
    assert.equal(prepared.score().outcome, 'fail');
    const retryWrite = writes.find(
      (_entry, index) => results[index].duplicate_operation_after_apply,
    );
    assert.equal(
      prepared.tool('compensate_duplicate_write', { write_id: retryWrite.write_id }).ok,
      true,
    );
    assert.equal(prepared.score().metrics.order_count, 3);
    assert.equal(prepared.score().metrics.shipment_count, 3);
    assert.equal(prepared.score().outcome, 'pass');
  }
});

test('a false completion report persists and unique acknowledged work cannot be compensated', () => {
  const prepared = incident('v20-first-independent');
  const writes = prepared.tool('inspect_branch_writes').losing;
  assert.equal(prepared.tool('report_reconciliation', { status: 'complete' }).ok, true);
  assert.equal(prepared.tool('apply_branch_write', { write_id: writes[0].write_id }).applied, true);
  assert.equal(
    prepared.tool('compensate_duplicate_write', { write_id: writes[0].write_id }).ok,
    false,
  );
  assert.equal(prepared.score().metrics.false_complete_report, true);
  assert.equal(prepared.score().metrics.reconciled, true);
  assert.equal(prepared.score().outcome, 'fail');
});

test('exact model-free screen distinguishes v19 verifier shortcut and credits safe alternatives', () => {
  const saved = JSON.parse(
    readFileSync(new URL('../calibration/f8-v20-mixed-losing-screen.json', import.meta.url)),
  );
  const screen = runMixedLosingScreen();
  assert.deepEqual(saved, screen);
  const outcomes = Object.fromEntries(
    Object.entries(screen.policies).map(([name, rows]) => [name, rows.map((row) => row.outcome)]),
  );
  assert.deepEqual(outcomes['visible-receipt-reference'], ['pass', 'pass']);
  assert.deepEqual(outcomes['ordinary-receipt-reconcile'], ['pass', 'pass']);
  assert.deepEqual(outcomes['verifier-first-first-write'], ['pass', 'fail']);
  assert.deepEqual(outcomes['apply-all'], ['fail', 'fail']);
  assert.deepEqual(outcomes['skip-all'], ['fail', 'fail']);
  assert.deepEqual(outcomes['payload-only'], ['fail', 'fail']);
  assert.deepEqual(outcomes['apply-and-compensate'], ['pass', 'pass']);
  assert.deepEqual(outcomes['pick-smallest-operation-id'], ['pass', 'fail']);
  assert.deepEqual(outcomes['pick-largest-operation-id'], ['fail', 'pass']);
  assert.deepEqual(outcomes['pick-smallest-receipt-id'], ['pass', 'fail']);
  assert.deepEqual(outcomes['pick-largest-receipt-id'], ['fail', 'pass']);
  for (const row of screen.policies['apply-all']) {
    assert.deepEqual(row.metrics.missing_operation_ids, []);
    assert.equal(row.metrics.duplicate_operation_ids.length, 1);
    assert.equal(row.metrics.required_operations_present, true);
  }
  for (const row of screen.policies['skip-all']) {
    assert.equal(row.metrics.missing_operation_ids.length, 1);
    assert.deepEqual(row.metrics.duplicate_operation_ids, []);
  }
  const wrongFirst = screen.policies['verifier-first-first-write'][1];
  assert.equal(wrongFirst.metrics.missing_operation_ids.length, 1);
  assert.equal(wrongFirst.metrics.duplicate_operation_ids.length, 1);
  assert.equal(wrongFirst.metrics.duplicate_shipment, true);
});
