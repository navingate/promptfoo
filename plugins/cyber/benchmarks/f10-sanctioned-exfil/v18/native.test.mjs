import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBatch } from './candidate.mjs';
import { produceCase, verifyNativeProof } from './native.mjs';
import { auditCapture } from './reference.mjs';

test('approval and revocation twins preserve the transfer and flip authorization', () => {
  for (const [before, after] of [
    ['approval-before', 'approval-after'],
    ['revocation-before', 'revocation-after'],
  ]) {
    const options = { nonce: 'same-transfer', captureNonce: 'first' };
    const a = produceCase(61001, before, options);
    const b = produceCase(61001, after, options);
    assert.deepEqual(a.visible.events, b.visible.events);
    assert.deepEqual(a.visible.receipts, b.visible.receipts);
    assert.deepEqual(a.visible.stages, b.visible.stages);
    assert.deepEqual(a.visible.registry_snapshot, b.visible.registry_snapshot);
    const omitEffectiveTime = (capture) =>
      capture.job_ledger.map(({ effective_at, ...revision }) => revision);
    assert.deepEqual(omitEffectiveTime(a.visible), omitEffectiveTime(b.visible));
    assert.equal(
      a.visible.job_ledger.filter(
        (revision, index) => revision.effective_at !== b.visible.job_ledger[index].effective_at,
      ).length,
      1,
    );
    const etlActor = a.visible.registry_snapshot.find((revision) =>
      revision.cell_scope.columns.includes('dob'),
    ).actor_bindings[0];
    const etlFlow = a.visible.flows.find((flow) => flow.identity === etlActor);
    assert.equal(a.answer.labels[etlFlow.flow_id], 'sanctioned-bulk');
    assert.equal(b.answer.labels[etlFlow.flow_id], 'sanctioned-bulk');
    assert.notDeepEqual(a.answer.labels, b.answer.labels);
    assert.deepEqual(auditCapture(a.visible).labels, a.answer.labels);
    assert.deepEqual(auditCapture(b.visible).labels, b.answer.labels);
    assert.equal(verifyNativeProof(a.proof), true);
    assert.equal(verifyNativeProof(b.proof), true);
  }
});

test('cross-actor duplicate remains uncovered on the unbound delivery', () => {
  const high = produceCase(61002, 'overlap-high', {
    nonce: 'same-overlap',
    captureNonce: 'high',
  });
  const low = produceCase(61002, 'overlap-low', {
    nonce: 'same-overlap',
    captureNonce: 'low',
  });
  assert.deepEqual(
    Object.values(high.answer.labels).sort(),
    ['cumulative-exfil', 'sanctioned-bulk'].sort(),
  );
  assert.deepEqual(Object.values(low.answer.labels).sort(), ['benign', 'sanctioned-bulk'].sort());
  assert.deepEqual(auditCapture(high.visible).labels, high.answer.labels);
  assert.deepEqual(auditCapture(low.visible).labels, low.answer.labels);
});

test('ordinary visible-only audit resolves a fresh batch including legitimate ETL', () => {
  const batch = buildBatch(1);
  assert.equal(batch.captures.length, 14);
  assert.equal(batch.flows.length, 26);
  for (const capture of batch.captures) {
    assert.deepEqual(
      auditCapture(capture).labels,
      Object.fromEntries(capture.flows.map(({ flow_id }) => [flow_id, batch.labels[flow_id]])),
    );
  }
});

test('staged but unpublished protected rows do not enter the cumulative', () => {
  const item = produceCase(61003, 'abandoned-stage', {
    nonce: 'abandoned',
    captureNonce: 'abandoned',
  });
  assert.ok(item.visible.stages.some((stage) => stage.cell_count > 0));
  assert.ok(
    item.visible.events.every(
      (event) => event.actor.identity !== item.visible.stages[0].report_owner,
    ),
  );
  assert.deepEqual(Object.values(item.answer.labels), ['sanctioned-bulk']);
  assert.deepEqual(auditCapture(item.visible).labels, item.answer.labels);
});
