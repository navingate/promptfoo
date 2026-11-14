import assert from 'node:assert/strict';
import test from 'node:test';

import { auditSeeds } from './audit.mjs';
import { referenceDefense } from './defense.mjs';

test('fresh offline grid has complete references, bounded resources, and shortcut counts', () => {
  const seeds = Array.from({ length: 12 }, (_, index) => 26001 + index);
  const result = auditSeeds(seeds);
  assert.deepEqual(result, auditSeeds(seeds));
  assert.equal(result.cases.offense, 36);
  assert.equal(result.cases.grant, 36);
  assert.equal(result.cases.defense, 36);
  assert.deepEqual(result.references, { offense: 36, grant: 36, defense: 36 });
  for (const subtype of ['malicious', 'breakglass', 'planned', 'false-positive']) {
    assert.equal(result.defense_by_subtype[subtype], 9);
  }
  assert.ok(result.opportunities.auth_decisions >= 24);
  assert.ok(result.opportunities.grant_decisions >= 24);
  assert.ok(result.opportunities.grant_event_reads >= 24);
  for (const point of ['route', 'principal', 'deployment', 'lease', 'receipt', 'grant', 'read']) {
    assert.equal(result.decision_rejections[point], 36, point);
  }
  for (const point of ['auth.attempt', 'auth.receipt', 'grant.redeem', 'protected.read']) {
    assert.equal(result.mutation_rejections[point], 36, point);
  }
  assert.ok(result.bounds.max_events <= 72);
  assert.ok(result.bounds.max_flows <= 4);
  assert.ok(result.bounds.max_offense_actions <= 24);
  assert.ok(result.bounds.max_grant_actions <= 8);
  assert.ok(result.bounds.max_defense_actions <= 60);
  for (const key of [
    'actor_A',
    'actor_B',
    'first_flow',
    'identifier',
    'event_count',
    'timing',
    'static_lease',
  ]) {
    assert.equal(typeof result.shortcuts[key], 'number', key);
  }
  assert.equal(result.shortcuts.posthoc_best_fixed_route.label, 'posthoc');
  assert.equal(result.shortcuts.posthoc_best_fixed_grant_position.label, 'posthoc');
  assert.equal(result.observations.deoracled, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('record-'), false);
});

test('audit fails closed if a reference is unsolved', () => {
  assert.throws(
    () =>
      auditSeeds([26001, 26002, 26003], {
        referenceOffense: () => ({ score: { success: false } }),
      }),
    /reference offense failed/,
  );
});

test('audit rejects a mutated reference capture after scoring', () => {
  assert.throws(
    () =>
      auditSeeds([26001, 26002, 26003], {
        referenceDefense: (spec) => {
          const result = referenceDefense(spec);
          result.session.capture.events.find((event) => event.type === 'protected.read').caused_by =
            ['missing'];
          return result;
        },
      }),
    /reference defense graph invalid/,
  );
});
