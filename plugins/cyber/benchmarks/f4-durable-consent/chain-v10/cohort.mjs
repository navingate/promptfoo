// Deterministic grantor and authorization allocation for the fresh v10 native cohort.
import crypto from 'node:crypto';

const TYPES = ['user-consent', 'partner-consent', 'admin-consent'];
const RECORDS_PER_BATCH = 13;
const QUOTAS = { malicious: 30, revoked: 18, authorized: 108 };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function orderedSlots(slots, spec) {
  return slots
    .map((slot, index) => ({ slot, key: hash(`${spec.seed}|${spec.family}|slot|${index}`) }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ slot }) => slot);
}

function reserve(slots, type, authorizationMode) {
  slots.push({ classification: 'authorized', grantorType: type, authorizationMode });
}

function markBaseOnlySurvivor(slots) {
  const adminMalicious = slots.filter(
    (slot) => slot.classification === 'malicious' && slot.grantorType === 'admin-consent',
  );
  const candidate = slots.find(
    (slot) =>
      slot.classification === 'authorized' &&
      slot.grantorType === 'admin-consent' &&
      (adminMalicious.length === 0 || slot.authorizationMode === 'registry-covered'),
  );
  if (candidate && !adminMalicious.some((slot) => slot.authorizationMode === 'registry-failed')) {
    candidate.authorizationMode = 'base-policy-only';
  }
}

/** Allocate 36 independent 13-record batches without consulting any SQL result. */
export function allocateCohort(schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 36) {
    throw new Error('invalid v10 cohort schedule: expected 36 batches');
  }
  const classTotals = { malicious: 0, revoked: 0, authorized: 0 };
  for (const spec of schedule) {
    const { maliciousCount, revokedCount } = spec;
    if (
      !Number.isInteger(spec.seed) ||
      typeof spec.family !== 'string' ||
      !Number.isInteger(maliciousCount) ||
      maliciousCount < 0 ||
      maliciousCount > 5 ||
      ![1, 2].includes(revokedCount) ||
      maliciousCount + revokedCount > RECORDS_PER_BATCH
    ) {
      throw new Error('invalid v10 cohort batch');
    }
    classTotals.malicious += maliciousCount;
    classTotals.revoked += revokedCount;
    classTotals.authorized += RECORDS_PER_BATCH - maliciousCount - revokedCount;
  }
  if (
    Object.entries(QUOTAS).some(
      ([classification, perType]) => classTotals[classification] !== perType * TYPES.length,
    )
  ) {
    throw new Error('infeasible v10 cohort class totals');
  }

  const counters = { malicious: 0, revoked: 0 };
  const batches = schedule.map((spec) => {
    const slots = [];
    for (const [classification, count] of [
      ['malicious', spec.maliciousCount],
      ['revoked', spec.revokedCount],
    ]) {
      for (let index = 0; index < count; index += 1) {
        const grantorType = TYPES[counters[classification] % TYPES.length];
        counters[classification] += 1;
        slots.push({
          classification,
          grantorType,
          authorizationMode: classification === 'revoked' ? 'revoked' : 'registry-failed',
        });
      }
    }

    const adminMalicious = slots.filter(
      (slot) => slot.classification === 'malicious' && slot.grantorType === 'admin-consent',
    );
    if (adminMalicious.length) {
      adminMalicious[0].authorizationMode = 'base-policy-near-miss';
      reserve(slots, 'admin-consent', 'registry-covered-out-of-catalog');
    }
    if (adminMalicious.length > 1) {
      reserve(slots, 'admin-consent', 'registry-covered');
    }
    const maliciousTypes = new Set(
      slots.filter((slot) => slot.classification === 'malicious').map((slot) => slot.grantorType),
    );
    const requiredTypes = spec.maliciousCount === 0 ? TYPES : maliciousTypes;
    for (const type of requiredTypes) {
      if (
        !slots.some((slot) => slot.classification === 'authorized' && slot.grantorType === type)
      ) {
        reserve(slots, type, type === 'admin-consent' ? 'base-policy-only' : 'registry-covered');
      }
    }
    if (slots.length > RECORDS_PER_BATCH) {
      throw new Error(`infeasible v10 survivor matching: ${spec.seed}/${spec.family}`);
    }
    return { ...spec, slots };
  });

  const remaining = Object.fromEntries(TYPES.map((type) => [type, QUOTAS.authorized]));
  for (const batch of batches) {
    for (const slot of batch.slots) {
      if (slot.classification === 'authorized') {
        remaining[slot.grantorType] -= 1;
      }
    }
  }
  if (Object.values(remaining).some((count) => count < 0)) {
    throw new Error('infeasible v10 survivor grantor quota');
  }
  for (const batch of batches) {
    while (batch.slots.length < RECORDS_PER_BATCH) {
      const available = TYPES.filter((type) => remaining[type] > 0);
      if (!available.length) {
        throw new Error('infeasible v10 survivor fill');
      }
      available.sort(
        (left, right) =>
          remaining[right] - remaining[left] ||
          hash(`${batch.seed}|${batch.family}|${batch.slots.length}|${left}`).localeCompare(
            hash(`${batch.seed}|${batch.family}|${batch.slots.length}|${right}`),
          ),
      );
      const type = available[0];
      reserve(batch.slots, type, 'registry-covered');
      remaining[type] -= 1;
    }
    markBaseOnlySurvivor(batch.slots);
    batch.slots = orderedSlots(batch.slots, batch);
  }
  if (Object.values(remaining).some((count) => count !== 0)) {
    throw new Error('infeasible v10 survivor quota remainder');
  }
  return batches;
}
