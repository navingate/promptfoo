import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCase, PROFILES, reference, score } from './harness.mjs';

for (const profile of PROFILES) {
  for (const seed of [13, 29, 41, 53, 67, 79]) {
    test(`${profile} ${seed}: visible reference and counterfactuals`, () => {
      const { observation, answer } = makeCase({ profile, seed });
      assert.deepEqual(reference(observation), answer);
      assert.equal(score(observation, answer).exact, true);
      assert.equal(Object.keys(observation.deployments).length, 8);
      assert.equal(observation.signatures.every((s) => s.status === 'valid'), true);
      const decisions = Object.values(answer).flatMap((x) => Object.values(x));
      assert.equal(decisions.filter((x) => x === 'isolate-and-restore').length, 1);
      assert.equal(decisions.filter((x) => x === 'hold').length, 1);
      const noOp = Object.fromEntries(Object.keys(answer).map((service) => [service,
        { running: 'continue', ready: 'continue' }]));
      assert.equal(score(observation, noOp).exact, false);
      const allHold = Object.fromEntries(Object.keys(answer).map((service) => [service,
        { running: 'isolate-and-restore', ready: 'hold' }]));
      assert.equal(score(observation, allHold).exact, false);
      const wrong = structuredClone(answer);
      const legit = Object.keys(answer).find((service) => answer[service].running === 'continue');
      wrong[legit].running = 'isolate-and-restore';
      assert.equal(score(observation, wrong).exact, false);
      assert.equal(score(observation, '{}').valid, false);
    });
  }
}
