import assert from 'node:assert/strict';
import test from 'node:test';

import { schedule } from '../chain-v9/generate-captures.mjs';
import { allocateCohort } from './cohort.mjs';

const TYPES = ['user-consent', 'partner-consent', 'admin-consent'];
const CLASSES = ['malicious', 'revoked', 'authorized'];
const TARGETS = { malicious: 30, revoked: 18, authorized: 108 };

test('allocates the exact class and grantor quotas across the native schedule', () => {
  const batches = allocateCohort(schedule());
  assert.equal(batches.length, 36);
  const counts = Object.fromEntries(
    CLASSES.map((name) => [name, Object.fromEntries(TYPES.map((type) => [type, 0]))]),
  );
  for (const batch of batches) {
    assert.equal(batch.slots.length, 13);
    assert.equal(
      batch.slots.filter((slot) => slot.classification === 'malicious').length,
      batch.maliciousCount,
    );
    assert.equal(
      batch.slots.filter((slot) => slot.classification === 'revoked').length,
      batch.revokedCount,
    );
    for (const slot of batch.slots) {
      assert.ok(CLASSES.includes(slot.classification));
      assert.ok(TYPES.includes(slot.grantorType));
      assert.equal(typeof slot.authorizationMode, 'string');
      counts[slot.classification][slot.grantorType] += 1;
    }
  }
  for (const classification of CLASSES) {
    for (const type of TYPES) {
      assert.equal(
        counts[classification][type],
        TARGETS[classification],
        `${classification}/${type}`,
      );
    }
  }
});

test('pairs each malicious grantor type with an authorized survivor in its batch', () => {
  for (const batch of allocateCohort(schedule())) {
    const maliciousTypes = new Set(
      batch.slots
        .filter((slot) => slot.classification === 'malicious')
        .map((slot) => slot.grantorType),
    );
    const survivorTypes = new Set(
      batch.slots
        .filter((slot) => slot.classification === 'authorized')
        .map((slot) => slot.grantorType),
    );
    for (const type of batch.maliciousCount === 0 ? TYPES : maliciousTypes) {
      assert.ok(survivorTypes.has(type), `${batch.seed}/${batch.family}: missing ${type}`);
    }
  }
});

test('pairs admin authorization subtypes within each batch', () => {
  const batches = allocateCohort(schedule());
  let nearMisses = 0;
  let baseOnly = 0;
  for (const batch of batches) {
    const slots = batch.slots;
    const adminNearMisses = slots.filter(
      (slot) =>
        slot.grantorType === 'admin-consent' && slot.authorizationMode === 'base-policy-near-miss',
    );
    assert.ok(adminNearMisses.length <= 1);
    if (adminNearMisses.length) {
      nearMisses += 1;
      assert.ok(
        slots.some(
          (slot) =>
            slot.grantorType === 'admin-consent' &&
            slot.classification === 'authorized' &&
            slot.authorizationMode === 'registry-covered-out-of-catalog',
        ),
      );
    }
    if (
      slots.some(
        (slot) =>
          slot.grantorType === 'admin-consent' &&
          slot.classification === 'malicious' &&
          slot.authorizationMode === 'registry-failed',
      )
    ) {
      assert.ok(
        slots.some(
          (slot) =>
            slot.grantorType === 'admin-consent' &&
            slot.classification === 'authorized' &&
            slot.authorizationMode === 'registry-covered',
        ),
      );
    }
    baseOnly += slots.filter(
      (slot) =>
        slot.grantorType === 'admin-consent' &&
        slot.classification === 'authorized' &&
        slot.authorizationMode === 'base-policy-only',
    ).length;
  }
  assert.ok(nearMisses > 0);
  assert.ok(baseOnly >= 12, `expected broader base-policy-only coverage, got ${baseOnly}`);
});

test('shuffling prevents classification or grantor type from being a slot-position label', () => {
  const positions = Array.from({ length: 13 }, () => ({ classes: new Set(), types: new Set() }));
  for (const batch of allocateCohort(schedule())) {
    batch.slots.forEach((slot, index) => {
      positions[index].classes.add(slot.classification);
      positions[index].types.add(slot.grantorType);
    });
  }
  assert.ok(positions.every(({ classes, types }) => classes.size > 1 && types.size > 1));
  assert.deepEqual(allocateCohort(schedule()), allocateCohort(schedule()));
});

test('rejects a schedule with impossible survivor matching', () => {
  const impossible = schedule();
  impossible[0] = { ...impossible[0], maliciousCount: 12, revokedCount: 1 };
  assert.throws(() => allocateCohort(impossible), /infeasible|invalid/i);
});
