import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { produceNativeBatchV9 } from './producer.mjs';

test('v9 produces every count through valid native sessions', () => {
  for (let count = 0; count <= 5; count += 1) {
    const batch = produceNativeBatchV9(
      { seed: 26031 + count, family: FAMILIES[count % FAMILIES.length] },
      { maliciousCount: count, revokedCount: count % 2 ? 2 : 1 },
    );
    assert.deepEqual(validateNativeBatch(batch), { ok: true });
    const labels = evaluatorLabels(batch);
    assert.deepEqual(referenceLabels(batch), labels);
    assert.equal(
      Object.values(labels).filter((value) => value === 'malicious-missed-by-query').length,
      count,
    );
    assert.equal(
      Object.values(labels).filter((value) => value === 'unauthorized-revoked').length,
      count % 2 ? 2 : 1,
    );
    assert.ok(Object.values(labels).filter((value) => value === 'same-user-survivor').length >= 6);
    assert.equal(new Set(batch.captures.map((capture) => capture.capture_id)).size, 13);
    assert.equal(new Set(batch.captures.map((capture) => capture.grant.grant_id)).size, 13);
  }
});

test('v9 rejects invalid count schedules', () => {
  const spec = { seed: 26031, family: FAMILIES[0] };
  for (const maliciousCount of [-1, 6, 1.5, undefined]) {
    assert.throws(() => produceNativeBatchV9(spec, { maliciousCount }));
  }
  assert.throws(() => produceNativeBatchV9(spec, { maliciousCount: 1, revokedCount: 3 }));
});
