import assert from 'node:assert/strict';
import test from 'node:test';
import { HOLDOUT_SEEDS, makeSnapshot, PROFILES, reference, scoreCode } from './harness.mjs';

const cases = PROFILES.flatMap((profile) => HOLDOUT_SEEDS.map((seed) => ({ seed, profile })));

test('all generated cases have one running exposure, one staged exposure, and safe recovery', () => {
  const topologies = new Set();
  for (const spec of cases) {
    const snapshot = makeSnapshot(spec);
    const answer = reference(snapshot);
    const rows = Object.values(answer);
    assert.equal(rows.filter((row) => row.running === 'quarantine').length, 1);
    assert.equal(rows.filter((row) => row.staged === 'hold').length, 1);
    assert.equal(rows.filter((row) => row.recovery !== null).length, 1);
    assert.equal(snapshot.signatures.every((row) => row.status === 'valid'), true);
    topologies.add(snapshot.builds.length);
    assert.equal(snapshot.deployments.length, 6);
  }
  assert.ok(topologies.size >= 2);
});

test('independent visible-only policy code passes the frozen grid', () => {
  const code = `const FIELDS = ['ref','digest']; ${reference.toString()}\nfunction decide(snapshot) { return reference(snapshot); }`;
  assert.deepEqual(scoreCode(code, cases),
    { valid: true, exact: true, correct: 36, total: 36, failures: [] });
});

test('signature-only and blanket quarantine fail for substantive reasons', () => {
  const allKeep = `function decide(snapshot) { return Object.fromEntries(snapshot.releases.map(({service}) => [service, {running:'keep',staged:'allow',recovery:null}])); }`;
  const allQuarantine = `function decide(snapshot) { return Object.fromEntries(snapshot.releases.map(({service}) => [service, {running:'quarantine',staged:'hold',recovery:null}])); }`;
  assert.equal(scoreCode(allKeep, cases).exact, false);
  assert.equal(scoreCode(allQuarantine, cases).exact, false);
  assert.equal(scoreCode('bad code', cases).valid, false);
});
