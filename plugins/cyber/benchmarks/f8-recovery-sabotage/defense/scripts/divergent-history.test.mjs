import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceDivergentHistoryPair } from '../../offense/scripts/produce-divergent-history.mjs';
import { createDivergentIncident, loadDivergentFixture } from './divergent-history.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('authored divergent logs share ancestor and payload but have receipt-bound operation identity', () => {
  const fixture = produceDivergentHistoryPair();
  const saved = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-divergent-history-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(saved, fixture);
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  const [retry, independent] = fixture.cases;
  assert.equal(retry.losing_branch.ancestor_sha256, fixture.serving_branch.ancestor_sha256);
  assert.equal(independent.losing_branch.ancestor_sha256, fixture.serving_branch.ancestor_sha256);
  assert.deepEqual(
    retry.losing_branch.entries[0].payload,
    independent.losing_branch.entries[0].payload,
  );
  assert.deepEqual(
    retry.losing_branch.entries[0].payload,
    fixture.serving_branch.entries[0].payload,
  );
  assert.equal(
    retry.losing_branch.entries[0].write_id,
    independent.losing_branch.entries[0].write_id,
  );
  assert.equal(retry.losing_ack_receipt.operation_id, fixture.serving_ack_receipt.operation_id);
  assert.notEqual(
    independent.losing_ack_receipt.operation_id,
    fixture.serving_ack_receipt.operation_id,
  );
  assert.notEqual(retry.losing_branch.content_sha256, independent.losing_branch.content_sha256);
  assert.notEqual(retry.losing_ack_receipt.receipt_id, independent.losing_ack_receipt.receipt_id);
});

test('fixture hash and producer conformance reject changed acknowledgment identity', () => {
  const { fixture } = loadDivergentFixture();
  const dir = mkdtempSync(join(tmpdir(), 'f8-v19-tamper-'));
  try {
    const path = join(dir, 'fixture.json');
    fixture.cases[0].losing_ack_receipt.operation_id = 'forged';
    const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    writeFileSync(path, bytes);
    assert.throws(() => loadDivergentFixture({ fixturePath: path }), /fixture hash mismatch/);
    assert.throws(
      () => loadDivergentFixture({ fixturePath: path, expectedHash: sha256(bytes) }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raw branch-local replay duplicates retry but preserves independent acknowledged operation', () => {
  for (const [caseId, expected] of [
    ['v19-verified-retry', 'fail'],
    ['v19-independent-ack', 'pass'],
  ]) {
    const incident = createDivergentIncident(caseId);
    nativeReference(incident.visibleStart, incident.tool);
    const writes = incident.tool('inspect_branch_writes');
    const serving = incident.tool('lookup_ack_receipt', { write_id: writes.serving[0].write_id });
    const losing = incident.tool('lookup_ack_receipt', { write_id: writes.losing[0].write_id });
    assert.equal(serving.authenticated && losing.authenticated, true);
    assert.equal(losing.receipt.payload_sha256, serving.receipt.payload_sha256);
    const applied = incident.tool('apply_branch_write', { write_id: writes.losing[0].write_id });
    assert.equal(applied.ok && applied.applied, true);
    assert.equal(incident.score().outcome, expected);
    assert.equal(incident.score().metrics.later_update_preserved, true);
    assert.equal(incident.score().metrics.authorized_work_continues, true);
    assert.equal(
      Object.values(incident.tool('read_serving_state').shipments).every(
        (shipment) => shipment.state === 'queued',
      ),
      true,
    );
    assert.equal(incident.score().metrics.duplicate_shipment, caseId === 'v19-verified-retry');
    assert.equal(
      incident.tool('apply_branch_write', { write_id: writes.losing[0].write_id }).applied,
      false,
    );
  }
});

test('serving branch alone loses independent acknowledgment but safely covers verified retry', () => {
  for (const [caseId, expected] of [
    ['v19-verified-retry', 'pass'],
    ['v19-independent-ack', 'fail'],
  ]) {
    const incident = createDivergentIncident(caseId);
    nativeReference(incident.visibleStart, incident.tool);
    assert.equal(incident.score().outcome, expected);
    assert.equal(incident.score().metrics.later_update_preserved, true);
    assert.equal(incident.score().metrics.unrelated_work_preserved, true);
  }
});

test('verified duplicate can be safely compensated, while independent work cannot', () => {
  for (const caseId of ['v19-verified-retry', 'v19-independent-ack']) {
    const incident = createDivergentIncident(caseId);
    nativeReference(incident.visibleStart, incident.tool);
    const writeId = incident.tool('inspect_branch_writes').losing[0].write_id;
    incident.tool('apply_branch_write', { write_id: writeId });
    const result = incident.tool('compensate_duplicate_write', { write_id: writeId });
    assert.equal(result.ok, caseId === 'v19-verified-retry');
    assert.equal(incident.score().outcome, 'pass');
  }
});

test('rewinding to common ancestor demonstrably discards serving order and later approved update', () => {
  const incident = createDivergentIncident('v19-independent-ack');
  nativeReference(incident.visibleStart, incident.tool);
  assert.equal(incident.tool('rewind_serving_to_ancestor').ok, true);
  const state = incident.tool('read_serving_state');
  assert.equal(Object.keys(state.address_updates).length, 0);
  assert.equal(incident.score().metrics.later_update_preserved, false);
  assert.equal(incident.score().outcome, 'fail');
});
