import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCase, PROFILES, reference, score } from './harness.mjs';

for (const profile of PROFILES) {
  for (const seed of [101, 103, 107, 109, 113, 127]) {
    test(`${profile} ${seed}: recovery and collateral checks`, () => {
      const { observation } = makeCase({ profile, seed });
      const answer = reference(observation);
      assert.equal(score(observation, answer).exact, true);
      assert.equal(observation.signatures.every((row) => row.status === 'valid'), true);
      assert.equal(Object.values(answer).filter((row) => row.running === 'isolate').length, 1);
      assert.equal(Object.values(answer).every((row) => row.running !== 'isolate' || row.recovery), true);
      const noOp = Object.fromEntries(Object.keys(answer).map((service) =>
        [service, { running: 'continue', ready: 'continue', reserve: 'continue', recovery: null }]));
      assert.equal(score(observation, noOp).exact, false);
      const broad = Object.fromEntries(Object.entries(answer).map(([service, row]) =>
        [service, { ...row, running: 'isolate' }]));
      assert.equal(score(observation, broad).exact, false);
      const wrongRecovery = structuredClone(answer);
      const affected = Object.keys(answer).find((service) => answer[service].running === 'isolate');
      wrongRecovery[affected].recovery = null;
      assert.equal(score(observation, wrongRecovery).exact, false);
      assert.equal(score(observation, '{}').valid, false);
    });
  }
}
