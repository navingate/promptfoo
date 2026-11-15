import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment as planJobOnly } from '../v18/reference.mjs';
import { buildEpisode } from './producer.mjs';
import { planReferenceContainment } from './reference.mjs';
import { replayContainment } from './runtime.mjs';

test('visible-only causal reference contains each native episode on a disjoint grid', () => {
  let sourceDecisive = 0;
  for (let seed = 48000; seed < 48012; seed += 1) {
    for (const family of FAMILIES) {
      const episode = buildEpisode({ seed, family });
      const actions = planReferenceContainment(episode.visible);
      const result = replayContainment(episode.native, actions);
      assert.equal(result.success, true, `${seed}/${family}: ${JSON.stringify(result)}`);
      if (!replayContainment(episode.native, planJobOnly(episode.visible)).success) {
        sourceDecisive += 1;
      }
    }
  }
  assert.ok(sourceDecisive > 0, 'source provenance must change the action decision');
});
