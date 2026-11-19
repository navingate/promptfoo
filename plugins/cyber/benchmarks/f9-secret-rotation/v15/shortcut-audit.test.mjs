import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { auditShortcuts, POLICIES, runFixedPolicy } from './shortcut-audit.mjs';

test('shortcut family covers fixed read, approval, disposition, and response choices', () => {
  assert.ok(POLICIES.length >= 1000);
  assert.ok(POLICIES.some((item) => item.read === 'display-0'));
  assert.ok(POLICIES.some((item) => item.read === 'first-allowed'));
  assert.ok(POLICIES.some((item) => item.approval === 'kind-emergency'));
  assert.ok(POLICIES.some((item) => item.response === 'revoke-first'));
  assert.ok(POLICIES.some((item) => item.response === 'first-consumer'));
  assert.ok(POLICIES.some((item) => item.response === 'rotate-all-safe'));
  const source = readFileSync(new URL('./shortcut-audit.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:inferDisposition|referenceDefense|validateNativeCapture)\b/);
});

test('fixed policy produces bounded staged outcomes without raw values', () => {
  const result = runFixedPolicy(
    { seed: 60001, family: 'cached-interval', subtype: 'malicious' },
    POLICIES[0],
  );
  assert.equal(typeof result.success, 'boolean');
  assert.ok(result.actionCount <= 60);
  assert.ok(result.elapsedMs < 2000);
  assert.doesNotMatch(JSON.stringify(result), /rcpt-|read-[a-f0-9]{32}|record-/);
});

test('selection uses training only and each holdout receives one selected policy', () => {
  const calls = [];
  const report = auditShortcuts({
    trainingSeeds: [60001],
    heldoutGrids: [[61001], [62001], [63001]],
    evaluate(spec, policy) {
      calls.push({ seed: spec.seed, policy });
      return {
        success: policy === POLICIES[0],
        stages: {
          triage: true,
          citation: true,
          scope: true,
          safety: true,
          old_access: true,
          service: true,
        },
        actionCount: 1,
        elapsedMs: 1,
      };
    },
  });
  assert.equal(report.trainingMatrix.length, POLICIES.length);
  assert.equal(calls.length, POLICIES.length * 4 + 3 * 4);
  assert.deepEqual(
    calls.slice(-12).map(({ seed }) => seed),
    [...Array(4).fill(61001), ...Array(4).fill(62001), ...Array(4).fill(63001)],
  );
  assert.ok(calls.slice(-12).every(({ policy }) => policy === report.selected.policy));
});

test('overlapping grids are rejected before evaluation', () => {
  assert.throws(
    () =>
      auditShortcuts({
        trainingSeeds: [64001],
        heldoutGrids: [[65001], [65001]],
        evaluate() {
          throw new Error('must not evaluate');
        },
      }),
    /overlap/i,
  );
});
