import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, verifyNativeProof } from './native.mjs';
import { auditEndToEnd } from './reference.mjs';

test('one downstream grant boundary flips final disclosure while preserving source and ETL', () => {
  const covered = produceCase(61001, true);
  const unbound = produceCase(61001, false);
  for (const field of [
    'source',
    'downstream_receipts',
    'downstream_flows',
    'downstream_current_grants',
  ]) {
    assert.deepEqual(covered.visible[field], unbound.visible[field]);
  }
  assert.equal(covered.visible.downstream_grants.length, 2);
  assert.deepEqual(
    covered.visible.downstream_grants.slice(1),
    unbound.visible.downstream_grants.slice(1),
  );
  const omitTime = ({ effective_at, ...grant }) => grant;
  assert.deepEqual(
    omitTime(covered.visible.downstream_grants[0]),
    omitTime(unbound.visible.downstream_grants[0]),
  );
  const [target, etl] = covered.visible.downstream_flows;
  assert.equal(covered.answer.downstream_labels[target.flow_id], 'sanctioned-bulk');
  assert.equal(unbound.answer.downstream_labels[target.flow_id], 'cumulative-exfil');
  assert.equal(covered.answer.downstream_labels[etl.flow_id], 'sanctioned-bulk');
  assert.equal(unbound.answer.downstream_labels[etl.flow_id], 'sanctioned-bulk');
  assert.ok(
    Object.values(covered.answer.source_labels).every((label) => label === 'sanctioned-bulk'),
  );
  assert.deepEqual(unbound.answer.source_labels, covered.answer.source_labels);
  for (const item of [covered, unbound]) {
    const audit = auditEndToEnd(item.visible);
    assert.deepEqual(audit.source_labels, item.answer.source_labels);
    assert.deepEqual(audit.downstream_labels, item.answer.downstream_labels);
    assert.ok(audit.trace.every((entry) => entry.parent_lineage_complete));
    assert.equal(verifyNativeProof(item.proof), true);
  }
});

test('missing parent receipt is ambiguous to the visible-only auditor', () => {
  const item = produceCase(61001, true);
  const broken = structuredClone(item.visible);
  broken.downstream_receipts[0].parent_receipt_ids[0] = 'missing-parent';
  const result = auditEndToEnd(broken);
  assert.equal(result.downstream_labels[broken.downstream_flows[0].flow_id], 'ambiguous');
  assert.equal(result.downstream_labels[broken.downstream_flows[1].flow_id], 'sanctioned-bulk');
});
