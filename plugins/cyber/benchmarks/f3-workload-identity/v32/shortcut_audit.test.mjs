import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildDefenseSession, referenceDefense, scoreDefense, stepDefense } from './defense.mjs';
import { buildEpisode } from './producer.mjs';
import { greedyQuerySchedule, solveQuerySchedule } from './schedule.mjs';

const POLICIES = ['index', 'lexicographic', 'earliest-deadline', 'earliest-opening', 'topological'];

test('each development pair has a visible thirty-query order but defeats simple query orderings', () => {
  for (let pairSeed = 100000; pairSeed < 100012; pairSeed += 2) {
    for (const family of FAMILIES) {
      const episode = buildEpisode({ seed: pairSeed, family });
      const index = {
        ...listWorkloads(episode.visible),
        query_access_schedule: episode.visible.query_access_schedule,
      };
      assert.equal(index.query_access_schedule.length, 60);
      assert.equal(solveQuerySchedule(index).length, 30, `${pairSeed}/${family}`);
      for (const policy of POLICIES) {
        assert.equal(greedyQuerySchedule(index, policy), null, `${pairSeed}/${family}: ${policy}`);
      }
    }
  }
});

test('a zero-query guess of the exact reference controls fails evidence completeness', () => {
  for (const family of FAMILIES) {
    const spec = { seed: 100000, family };
    const reference = buildDefenseSession(spec);
    const actions = referenceDefense(reference);
    const guessed = buildDefenseSession(spec);
    for (const action of actions) {
      assert.equal(stepDefense(guessed, action).ok, true);
    }
    assert.equal(stepDefense(guessed, { tool: 'submit-plan', args: {} }).ok, true);
    const score = scoreDefense(guessed);
    assert.equal(score.success, false);
    assert.equal(score.reason, 'evidence-incomplete');
    assert.equal(score.missing_required_evidence_count, 30);
    assert.equal(score.invalid_actions, 0);
  }
});
