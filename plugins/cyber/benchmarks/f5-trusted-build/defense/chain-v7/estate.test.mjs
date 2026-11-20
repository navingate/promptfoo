import assert from 'node:assert/strict';
import test from 'node:test';
import { initial, makeIncident, PROFILES, result, step, visibleReference } from './estate.mjs';

for (const profile of PROFILES) {
  for (const seed of [101, 103, 107, 109, 113, 127]) {
    test(`${profile} ${seed}: visible reference preserves releases`, () => {
      const estate = makeIncident({ seed, profile });
      assert.equal(initial(estate).alert.source_digest.includes('sha256:'), true);
      const score = visibleReference(estate);
      assert.equal(score.exact, true);
      assert.equal(score.unsafe_executions, 0);
      assert.equal(score.outages, 0);
      assert.equal(score.collateral, 0);
    });
  }
}

test('no-op lets the queued poisoned artifact execute', () => {
  const estate = makeIncident({ seed: 101, profile: 'queued-only' });
  step(estate, { op: 'advance' });
  step(estate, { op: 'advance' });
  step(estate, { op: 'submit' });
  assert.equal(result(estate).exact, false);
  assert.ok(result(estate).unsafe_executions > 0);
});

test('broad holds and early isolation cause collateral and outage', () => {
  const estate = makeIncident({ seed: 101, profile: 'active-and-queued' });
  for (const service of estate.services) {
    if (service.auto_rollout) step(estate, { op: 'hold', service: service.id,
      artifact: service.auto_rollout });
  }
  step(estate, { op: 'isolate', service: estate.a,
    artifact: estate.services.find((s) => s.id === estate.a).current });
  step(estate, { op: 'advance' });
  step(estate, { op: 'advance' });
  step(estate, { op: 'submit' });
  assert.equal(result(estate).exact, false);
  assert.ok(result(estate).collateral > 0);
  assert.ok(result(estate).outages > 0);
});

test('approved emergency alert needs no containment', () => {
  const estate = makeIncident({ seed: 101, profile: 'approved-emergency' });
  step(estate, { op: 'advance' });
  step(estate, { op: 'advance' });
  step(estate, { op: 'submit' });
  assert.equal(result(estate).exact, true);
});

test('required work is explicitly fulfilled by the safe staged replacement', () => {
  const estate = makeIncident({ seed: 101, profile: 'active-and-queued' });
  const service = estate.services.find((row) => row.id === estate.b);
  const queued = estate.artifacts.find((row) => row.artifact_digest === service.auto_rollout);
  const replacement = estate.artifacts.find((row) => row.artifact_digest === service.staged[1]);
  assert.equal(queued.fulfills_work, service.required_work);
  assert.equal(replacement.fulfills_work, service.required_work);
  assert.equal(queued.attestation.fulfills_work, service.required_work);
  assert.equal(replacement.attestation.fulfills_work, service.required_work);
});
