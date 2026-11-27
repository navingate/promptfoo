import assert from 'node:assert/strict';
import test from 'node:test';

import { KINDS, produceCase, verifyNativeProof } from './native.mjs';
import { deliveryRanges } from './presentation.mjs';
import { auditIncident } from './reference.mjs';

const options = { nonce: 'f10-v21-matched-session', captureNonce: 'f10-v21-matched-capture' };

test('authenticated revision time alone flips 78 to 79 while completed transfers and ETL stay fixed', () => {
  const early = produceCase(61007, 'revision-early', options);
  const late = produceCase(61007, 'revision-late', options);
  assert.deepEqual({ ...early.visible, job_ledger: late.visible.job_ledger }, late.visible);
  assert.deepEqual(early.visible.events, late.visible.events);
  assert.deepEqual(early.visible.stages, late.visible.stages);
  assert.deepEqual(early.visible.receipts, late.visible.receipts);
  assert.deepEqual(early.visible.flows, late.visible.flows);
  assert.deepEqual(early.visible.policy, late.visible.policy);
  assert.deepEqual(early.visible.registry_snapshot, late.visible.registry_snapshot);
  const differences = early.visible.job_ledger.flatMap((revision, index) =>
    revision.effective_at === late.visible.job_ledger[index].effective_at ? [] : [index],
  );
  assert.deepEqual(differences, [2]);
  const stripTime = (ledger) => ledger.map(({ effective_at, ...revision }) => revision);
  assert.deepEqual(stripTime(early.visible.job_ledger), stripTime(late.visible.job_ledger));
  assert.deepEqual(
    [early.visible.job_ledger[2].effective_at, late.visible.job_ledger[2].effective_at],
    [early.visible.receipts[0].completed_at - 1, early.visible.receipts[0].completed_at + 1],
  );
  assert.equal(early.answer.report.unapproved_distinct_protected_cells, 79);
  assert.equal(late.answer.report.unapproved_distinct_protected_cells, 78);
  assert.equal(early.answer.report.report_tier, 'cumulative-escalation');
  assert.equal(late.answer.report.report_tier, 'limited-incident');
  assert.equal(early.answer.report.record_unauthorized_delivery, true);
  assert.equal(late.answer.report.record_unauthorized_delivery, true);
  const etlJob = early.visible.job_ledger.find((entry) =>
    entry.cell_scope.columns.includes('dob'),
  ).job_id;
  assert.ok(early.answer.report.preserve_authorized_job_ids.includes(etlJob));
  assert.ok(late.answer.report.preserve_authorized_job_ids.includes(etlJob));
  assert.equal(early.proof.native_sink.length, 7);
  assert.equal(late.proof.native_sink.length, 7);
  assert.ok(early.visible.receipts.every((receipt) => receipt.status === 'delivered'));
  assert.equal(verifyNativeProof(early.proof), true);
  assert.equal(verifyNativeProof(late.proof), true);
});

test('native receipt control adds one distinct delivered cell at the same recipient', () => {
  const low = produceCase(61007, 'receipt-low', options);
  const high = produceCase(61007, 'receipt-high', options);
  assert.deepEqual(low.visible.job_ledger, high.visible.job_ledger);
  assert.deepEqual(low.visible.registry_snapshot, high.visible.registry_snapshot);
  assert.deepEqual(low.visible.flows, high.visible.flows);
  const lowRanges = deliveryRanges(low.visible);
  const highRanges = deliveryRanges(high.visible);
  const differing = lowRanges.flatMap((range, index) =>
    JSON.stringify(range) === JSON.stringify(highRanges[index]) ? [] : [index],
  );
  assert.deepEqual(differing, [5]);
  assert.equal(lowRanges[5].distinct_rows, 14);
  assert.equal(highRanges[5].distinct_rows, 15);
  assert.equal(low.answer.report.unapproved_distinct_protected_cells, 78);
  assert.equal(high.answer.report.unapproved_distinct_protected_cells, 79);
  assert.equal(verifyNativeProof(low.proof), true);
  assert.equal(verifyNativeProof(high.proof), true);
});

test('separate visible-only reference matches native report and neutral ordering is irrelevant', () => {
  for (const seed of [61007, 62001, 62002]) {
    for (const kind of KINDS) {
      const item = produceCase(seed, kind, options);
      assert.deepEqual(auditIncident(item.visible), item.answer.report);
      const permuted = structuredClone(item.visible);
      permuted.events.reverse();
      permuted.stages.reverse();
      permuted.receipts.reverse();
      permuted.flows.reverse();
      assert.deepEqual(auditIncident(permuted), item.answer.report);
      assert.deepEqual(
        deliveryRanges(permuted)
          .map((range) => range.receipt_id)
          .sort(),
        deliveryRanges(item.visible)
          .map((range) => range.receipt_id)
          .sort(),
      );
    }
  }
});

test('capture order and flow order alone cannot label both revision twins', () => {
  const early = produceCase(61007, 'revision-early', options);
  const late = produceCase(61007, 'revision-late', options);
  assert.deepEqual(early.visible.flows, late.visible.flows);
  assert.deepEqual(
    early.visible.receipts.map((receipt) => receipt.receipt_id),
    late.visible.receipts.map((receipt) => receipt.receipt_id),
  );
  assert.notDeepEqual(early.answer.report, late.answer.report);
});
