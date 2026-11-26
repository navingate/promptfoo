import assert from 'node:assert/strict';
import test from 'node:test';

import { produceCase, verifyNativeProof } from './native.mjs';
import { auditApproval } from './reference.mjs';

test('delegation timing alone flips the primary completed transfer, preserving ETL', () => {
  const authorized = produceCase(61001, true);
  const invalid = produceCase(61001, false);
  for (const field of [
    'events',
    'receipts',
    'stages',
    'job_ledger',
    'registry_snapshot',
    'change_tickets',
    'current_delegations',
    'flows',
  ]) {
    assert.deepEqual(authorized.visible[field], invalid.visible[field]);
  }
  assert.equal(authorized.visible.delegation_history[0].valid_from, 0);
  assert.equal(invalid.visible.delegation_history[0].valid_from, 10);
  assert.deepEqual(
    authorized.visible.delegation_history.slice(1),
    invalid.visible.delegation_history.slice(1),
  );
  const [primary, etl] = authorized.visible.flows;
  assert.equal(authorized.answer.labels[primary.flow_id], 'sanctioned-bulk');
  assert.equal(invalid.answer.labels[primary.flow_id], 'cumulative-exfil');
  assert.equal(authorized.answer.labels[etl.flow_id], 'sanctioned-bulk');
  assert.equal(invalid.answer.labels[etl.flow_id], 'sanctioned-bulk');
  assert.deepEqual(auditApproval(authorized.visible).labels, authorized.answer.labels);
  assert.deepEqual(auditApproval(invalid.visible).labels, invalid.answer.labels);
  assert.equal(verifyNativeProof(authorized.proof), true);
  assert.equal(verifyNativeProof(invalid.proof), true);
});

test('visible audit rejects a ticket whose scope no longer matches the job', () => {
  const item = produceCase(61001, true);
  const wrong = structuredClone(item.visible);
  wrong.change_tickets.find(
    (ticket) => ticket.signer === 'data-owner-customers',
  ).cell_scope.row_max = 0;
  const labels = auditApproval(wrong).labels;
  assert.equal(labels[item.visible.flows[0].flow_id], 'cumulative-exfil');
  assert.equal(labels[item.visible.flows[1].flow_id], 'sanctioned-bulk');
});
