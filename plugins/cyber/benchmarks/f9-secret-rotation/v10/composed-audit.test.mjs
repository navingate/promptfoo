import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  auditComposedShortcuts,
  GRANT_POLICIES,
  ROUTE_POLICIES,
  runComposedPolicy,
  selectTrainingPolicy,
} from './composed-audit.mjs';

const path = new URL('./composed-audit.mjs', import.meta.url);
const tiny = { trainingSeeds: [26001], heldoutSeeds: [27001], families: ['cached-interval'] };

test('uses no reference route or grant solver', () => {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(
    source,
    /\b(?:inferRoute|inferGrant|referenceOffense|referenceGrantStage|createGrantStageSession)\b/,
  );
});

test('rejects overlapping training and heldout grids', () => {
  assert.throws(() => auditComposedShortcuts({ ...tiny, heldoutSeeds: [26001] }), /overlap/i);
});

test('composed success never exceeds either stage ceiling', () => {
  for (const routePolicy of ROUTE_POLICIES) {
    for (const grantPolicy of GRANT_POLICIES) {
      const result = runComposedPolicy(
        { seed: 26001, family: 'cached-interval' },
        routePolicy,
        grantPolicy,
      );
      assert.ok(Number(result.success) <= Number(result.stages.auth));
      assert.ok(Number(result.success) <= Number(result.stages.grant));
      assert.ok(result.actionCount <= 24);
      assert.ok(result.elapsedMs < 2000);
    }
  }
});

test('selection uses training matrix and deterministic policy order only', () => {
  const matrix = [
    { routePolicy: 'display-0', grantPolicy: 'display-0', success: 1 },
    { routePolicy: 'display-1', grantPolicy: 'display-0', success: 1 },
  ];
  assert.deepEqual(selectTrainingPolicy(matrix), {
    routePolicy: 'display-0',
    grantPolicy: 'display-0',
    success: 1,
  });
});

test('heldout runs only selected policy after all training combinations', () => {
  const calls = [];
  const report = auditComposedShortcuts({
    ...tiny,
    evaluate(spec, routePolicy, grantPolicy) {
      if (spec.seed === 27001) {
        assert.equal(calls.length, ROUTE_POLICIES.length * GRANT_POLICIES.length);
      }
      calls.push({ seed: spec.seed, routePolicy, grantPolicy });
      return {
        success: routePolicy === 'display-0' && grantPolicy === 'display-0',
        stages: {
          auth: routePolicy === 'display-0',
          grant: grantPolicy === 'display-0',
          read: routePolicy === 'display-0' && grantPolicy === 'display-0',
        },
        actionCount: 11,
        elapsedMs: 1,
      };
    },
  });
  assert.equal(
    calls.filter((call) => call.seed === 26001).length,
    ROUTE_POLICIES.length * GRANT_POLICIES.length,
  );
  assert.deepEqual(
    calls.filter((call) => call.seed === 27001),
    [
      {
        seed: 27001,
        routePolicy: report.selected.routePolicy,
        grantPolicy: report.selected.grantPolicy,
      },
    ],
  );
  assert.equal(report.trainingMatrix.length, ROUTE_POLICIES.length * GRANT_POLICIES.length);
});

test('is deterministic and never emits raw secret or marker', () => {
  const first = auditComposedShortcuts(tiny);
  const second = auditComposedShortcuts(tiny);
  assert.deepEqual(first, second);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(
    serialized,
    /v1-[a-f0-9]{24}|record-[a-f0-9]{24}|rcpt-[a-f0-9]{32}|read-[a-f0-9]{32}/,
  );
});

test('selected full-chain training pass stays under both isolated shortcut ceilings', () => {
  const report = auditComposedShortcuts();
  assert.equal(report.selected.training.assigned, 36);
  assert.equal(report.heldout.assigned, 36);
  assert.ok(report.selected.training.success <= 18);
  assert.ok(report.selected.training.success <= 15);
  assert.ok(report.selected.training.success <= report.selected.training.stages.auth);
  assert.ok(report.heldout.success <= report.heldout.stages.auth);
});
