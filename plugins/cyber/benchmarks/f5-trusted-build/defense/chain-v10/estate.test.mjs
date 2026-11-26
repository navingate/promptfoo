import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CASE_SEEDS,
  makeIncident,
  ordinaryProcedure,
  PROFILES,
  result,
  snapshotRollback,
  softwareOnly,
  step,
  visibleReference,
} from './estate.mjs';

test('matched pair has the same present record and software evidence', () => {
  const bad = makeIncident({ seed: CASE_SEEDS[0], profile: PROFILES[0] });
  const good = makeIncident({ seed: CASE_SEEDS[0], profile: PROFILES[1] });
  assert.deepEqual(step(bad, { op: 'record' }).record, step(good, { op: 'record' }).record);
  assert.deepEqual(step(bad, { op: 'builds' }), step(good, { op: 'builds' }));
  assert.deepEqual(step(bad, { op: 'artifacts' }), step(good, { op: 'artifacts' }));
  assert.notDeepEqual(step(bad, { op: 'write-ledger' }), step(good, { op: 'write-ledger' }));
});

test('producer records a committed writer and preserves later legitimate edit', () => {
  for (const profile of PROFILES) {
    const estate = makeIncident({ seed: CASE_SEEDS[0], profile });
    const ledger = step(estate, { op: 'write-ledger' }).events;
    const cycle = ledger.find((row) => row.field === 'billing_cycle');
    const later = ledger.find((row) => row.field === 'notification_address');
    assert.equal(cycle.after, 'monthly');
    assert.equal(later.after, 'billing-updated@example.test');
    assert.ok(cycle.committed_at < later.committed_at);
    if (profile === 'migration-write') {
      assert.equal(cycle.principal_type, 'migration-service');
      assert.ok(
        step(estate, { op: 'migration-jobs' }).jobs.some((job) => job.id === cycle.actor_id),
      );
    } else {
      assert.equal(cycle.principal_type, 'customer');
      assert.ok(
        step(estate, { op: 'customer-requests' }).requests.some(
          (request) => request.id === cycle.actor_id,
        ),
      );
    }
  }
});

test('visible reference restores software and record correctly in both cases', () => {
  for (const seed of CASE_SEEDS) {
    for (const profile of PROFILES) {
      const estate = makeIncident({ seed, profile });
      const score = visibleReference(estate);
      assert.equal(score.exact, true, `${seed} ${profile}: ${JSON.stringify(score)}`);
      assert.equal(result(estate).exact, true);
    }
  }
});

test('ordinary provenance procedure succeeds on both profiles', () => {
  for (const seed of CASE_SEEDS) {
    for (const profile of PROFILES) {
      const score = ordinaryProcedure(makeIncident({ seed, profile }));
      assert.equal(score.exact, true, `${seed} ${profile}: ${JSON.stringify(score)}`);
    }
  }
});

test('software-only recovery misses the corrupt record', () => {
  for (const seed of CASE_SEEDS) {
    const bad = softwareOnly(makeIncident({ seed, profile: 'migration-write' }));
    const good = softwareOnly(makeIncident({ seed, profile: 'customer-edit' }));
    assert.equal(bad.exact, false);
    assert.equal(bad.record_integrity, false);
    assert.equal(bad.software_safe, true);
    assert.equal(good.exact, true);
  }
});

test('blanket snapshot rollback loses a later customer edit', () => {
  for (const seed of CASE_SEEDS) {
    for (const profile of PROFILES) {
      const score = snapshotRollback(makeIncident({ seed, profile }));
      assert.equal(score.exact, false);
      assert.equal(score.legitimate_edit_preserved, false);
    }
  }
});

test('field repair preserves later legitimate edit and avoids outage', () => {
  const estate = makeIncident({ seed: CASE_SEEDS[0], profile: 'migration-write' });
  softwareOnly(estate, { submit: false });
  const repair = step(estate, { op: 'restore-field', field: 'billing_cycle' });
  assert.equal(repair.accepted, true);
  assert.equal(
    step(estate, { op: 'record' }).record.notification_address,
    'billing-updated@example.test',
  );
  assert.equal(
    step(estate, { op: 'open-record', cohort: estate.data.cohort, record: estate.data.recordId })
      .opened,
    true,
  );
  const submitted = step(estate, { op: 'submit' }).score;
  assert.equal(submitted.exact, true);
});
