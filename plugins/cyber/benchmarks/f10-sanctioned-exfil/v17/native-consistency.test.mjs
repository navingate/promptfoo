import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOffenseSession } from '../v13/chain.mjs';
import { runExportPlane } from '../v13/estate.mjs';
import {
  CAPTURE_KINDS as OLD_KINDS,
  CAPTURE_SEEDS as OLD_SEEDS,
  produceCase as oldCase,
  verifyNativeProof as verifyOld,
} from '../v15/capture-producer.mjs';
import {
  KINDS as OVERLAP_KINDS,
  SEEDS as OVERLAP_SEEDS,
  produceCase as overlapCase,
  verifyNativeProof as verifyOverlap,
} from '../v16/holdout-producer.mjs';
import { labelNative } from './authorization.mjs';
import { detect } from './reference.mjs';

function check(produced) {
  const { visible, proof } = produced;
  const session = createOffenseSession({ ...proof.spec, extraJobs: proof.extraJobs });
  const replay = runExportPlane(proof.native_actions, session.world);
  assert.equal(replay.blocked.length, 0);
  const native = labelNative(replay.events, session.world.job_registry, session.world.policy);
  const expected = Object.fromEntries(
    visible.flows.map((flow) => {
      const found = native.find(
        (item) =>
          item.identity === flow.identity &&
          item.destination === flow.destination &&
          item.window === flow.window,
      );
      assert.ok(found);
      return [flow.flow_id, found.label];
    }),
  );
  assert.deepEqual(detect(visible), expected);
  return Object.values(expected);
}

test('v17 native scorer and visible-only reference agree on all completed native cases', () => {
  const counts = { 'cumulative-exfil': 0, 'sanctioned-bulk': 0, ambiguous: 0, benign: 0 };
  for (const seed of OLD_SEEDS.slice(0, 12)) {
    for (const kind of OLD_KINDS) {
      const produced = oldCase(seed, kind, {
        nonce: `v17-old-${seed}-${kind}`,
        captureNonce: `v17-old-cap-${seed}-${kind}`,
      });
      assert.equal(verifyOld(produced.proof), true);
      for (const label of check(produced)) {
        counts[label] += 1;
      }
    }
  }
  for (const seed of OVERLAP_SEEDS) {
    for (const kind of OVERLAP_KINDS) {
      const produced = overlapCase(seed, kind, {
        nonce: `v17-overlap-${seed}-${kind}`,
        captureNonce: `v17-overlap-cap-${seed}-${kind}`,
      });
      assert.equal(verifyOverlap(produced.proof), true);
      for (const label of check(produced)) {
        counts[label] += 1;
      }
    }
  }
  assert.deepEqual(counts, {
    'cumulative-exfil': 48,
    'sanctioned-bulk': 84,
    ambiguous: 0,
    benign: 84,
  });
});
