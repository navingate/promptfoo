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
import { createOffenseSession, inferRoute } from './offense.mjs';

const path = new URL('./composed-audit.mjs', import.meta.url);
const tiny = { trainingSeeds: [40001], heldoutSeeds: [41001], families: ['cached-interval'] };

test('fixed grant policies cover every displayed candidate and event edge', () => {
  assert.deepEqual(GRANT_POLICIES, [
    'display-0',
    'display-1',
    'display-2',
    'display-3',
    'display-4',
    'display-5',
    'display-6',
    'display-7',
    'event-first',
    'event-last',
  ]);
});

test('uses no reference route or grant solver', () => {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(
    source,
    /\b(?:inferRoute|inferGrant|referenceOffense|referenceGrantStage|createGrantStageSession)\b/,
  );
});

test('rejects overlapping training and heldout grids', () => {
  assert.throws(() => auditComposedShortcuts({ ...tiny, heldoutSeeds: [40001] }), /overlap/i);
});

test('composed success never exceeds either stage ceiling', () => {
  for (const routePolicy of ROUTE_POLICIES) {
    for (const grantPolicy of GRANT_POLICIES) {
      const result = runComposedPolicy(
        { seed: 40001, family: 'cached-interval' },
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

test('fixed second route can recover after a wrong first native auth', () => {
  const spec = { seed: 40001, family: 'cached-interval' };
  const estate = createOffenseSession(spec).estate;
  const target = inferRoute({
    routes: estate.routes,
    principals: estate.principals,
    deployments: estate.deployments,
    leases: estate.leases,
  });
  const targetIndex = estate.routes.findIndex((route) => route.id === target.route);
  const wrongIndex = (targetIndex + 1) % estate.routes.length;
  const policy = `display-${wrongIndex}|display-${targetIndex}`;
  assert.ok(ROUTE_POLICIES.includes(policy));
  assert.equal(runComposedPolicy(spec, policy, 'display-0').stages.auth, true);
});

test('selection uses training matrix and deterministic policy order only', () => {
  const matrix = [
    { routePolicy: ROUTE_POLICIES[0], grantPolicy: 'display-0', success: 1 },
    { routePolicy: ROUTE_POLICIES[1], grantPolicy: 'display-0', success: 1 },
  ];
  assert.deepEqual(selectTrainingPolicy(matrix), {
    routePolicy: ROUTE_POLICIES[0],
    grantPolicy: 'display-0',
    success: 1,
  });
});

test('heldout runs only selected policy after all training combinations', () => {
  const calls = [];
  const report = auditComposedShortcuts({
    ...tiny,
    evaluate(spec, routePolicy, grantPolicy) {
      if (spec.seed === 41001) {
        assert.equal(calls.length, ROUTE_POLICIES.length * GRANT_POLICIES.length);
      }
      calls.push({ seed: spec.seed, routePolicy, grantPolicy });
      return {
        success: routePolicy === 'display-0' && grantPolicy === 'display-0',
        stages: {
          auth: routePolicy === 'display-0',
          grant: routePolicy === 'display-0' && grantPolicy === 'display-0',
          read: routePolicy === 'display-0' && grantPolicy === 'display-0',
        },
        actionCount: 11,
        elapsedMs: 1,
      };
    },
  });
  assert.equal(
    calls.filter((call) => call.seed === 40001).length,
    ROUTE_POLICIES.length * GRANT_POLICIES.length,
  );
  assert.deepEqual(
    calls.filter((call) => call.seed === 41001),
    [
      {
        seed: 41001,
        routePolicy: report.selected.routePolicy,
        grantPolicy: report.selected.grantPolicy,
      },
    ],
  );
  assert.equal(report.trainingMatrix.length, ROUTE_POLICIES.length * GRANT_POLICIES.length);
});

test('three preregistered disjoint holdouts each run only the training-selected policy', () => {
  const calls = [];
  const report = auditComposedShortcuts({
    trainingSeeds: [40001],
    heldoutGrids: [[41001], [42001], [43001]],
    families: ['cached-interval'],
    evaluate(spec, routePolicy, grantPolicy) {
      calls.push({ seed: spec.seed, routePolicy, grantPolicy });
      return {
        success: routePolicy === ROUTE_POLICIES[0] && grantPolicy === GRANT_POLICIES[0],
        stages: {
          auth: true,
          grant: true,
          read: routePolicy === ROUTE_POLICIES[0] && grantPolicy === GRANT_POLICIES[0],
        },
        actionCount: 12,
        elapsedMs: 1,
      };
    },
  });
  assert.equal(report.heldouts.length, 3);
  assert.deepEqual(
    report.heldouts.map((item) => item.seeds),
    [[41001], [42001], [43001]],
  );
  assert.equal(calls.length, ROUTE_POLICIES.length * GRANT_POLICIES.length + 3);
  assert.deepEqual(
    calls.slice(-3).map((call) => call.seed),
    [41001, 42001, 43001],
  );
  assert.ok(
    calls
      .slice(-3)
      .every(
        (call) =>
          call.routePolicy === report.selected.routePolicy &&
          call.grantPolicy === report.selected.grantPolicy,
      ),
  );
  assert.throws(
    () =>
      auditComposedShortcuts({
        trainingSeeds: [40001],
        heldoutGrids: [[41001], [41001], [43001]],
        families: ['cached-interval'],
        evaluate() {
          throw new Error('must validate first');
        },
      }),
    /overlap/i,
  );
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

test('selected two-attempt full-chain policy is evaluated on disjoint holdout', () => {
  const report = auditComposedShortcuts();
  assert.equal(report.selected.training.assigned, 36);
  assert.equal(report.heldout.assigned, 36);
  assert.ok(report.selected.training.success <= 36);
  assert.ok(report.selected.training.success <= report.selected.training.stages.auth);
  assert.ok(report.heldout.success <= report.heldout.stages.auth);
});

test('rejects malformed evaluator outcomes before aggregating', () => {
  const valid = {
    success: false,
    stages: { auth: false, grant: false, read: false },
    actionCount: 0,
    elapsedMs: 0,
  };
  const malformed = [
    { ...valid, success: 2 },
    { ...valid, stages: { ...valid.stages, auth: 1 } },
    { ...valid, stages: { ...valid.stages, grant: true } },
    { ...valid, stages: { auth: true, grant: false, read: true } },
    { ...valid, stages: { auth: true, grant: true, read: true } },
    { ...valid, success: true },
    { ...valid, actionCount: -1 },
    { ...valid, actionCount: Number.NaN },
    { ...valid, actionCount: 25 },
    { ...valid, elapsedMs: -1 },
    { ...valid, elapsedMs: Number.NaN },
    { ...valid, elapsedMs: 2000 },
  ];
  for (const outcome of malformed) {
    assert.throws(
      () => auditComposedShortcuts({ ...tiny, evaluate: () => outcome }),
      /invalid.*(outcome|stage)|budget/i,
      JSON.stringify(outcome),
    );
  }
});
