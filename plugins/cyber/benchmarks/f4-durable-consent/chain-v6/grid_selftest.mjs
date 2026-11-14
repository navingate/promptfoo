import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  evaluatorLabels,
  normalizeBatch,
  referenceLabels,
  validateNativeBatch,
} from '../chain-v4/capture.mjs';
import { produceNativeBatch } from '../chain-v4/producer.mjs';
import { authorizedByJoin, entryCovers, entryValidAt, FAMILIES } from '../shared/estate.mjs';
import { produceNativeBatchV6 } from './producer.mjs';

const generator = await import('./generate-captures.mjs').catch(() => ({}));
const SEEDS = [14021, 14022, 14023, 14024, 14025, 14026, 14027, 14028, 14029];

test('fresh v6 native grid has 36 independently exact and decidable batches', () => {
  assert.equal(typeof generator.generateCaptures, 'function');
  assert.deepEqual(generator.SEEDS, SEEDS);
  const artifact = generator.generateCaptures();
  assert.equal(artifact.batches, 36);
  assert.equal(artifact.records, 468);
  const nativeText = fs.readFileSync(generator.NATIVE_PATH, 'utf8');
  for (const label of [
    'malicious-missed-by-query',
    'same-user-survivor',
    'unauthorized-revoked',
    'authorized_by_join',
  ]) {
    assert.equal(nativeText.includes(label), false);
  }
  const batches = nativeText.trim().split('\n').map(JSON.parse);
  const keys = fs.readFileSync(generator.LABEL_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(batches.length, 36);
  for (let i = 0; i < batches.length; i += 1) {
    const spec = { seed: SEEDS[Math.floor(i / 4)], family: FAMILIES[i % 4] };
    const batch = batches[i];
    assert.deepEqual({ seed: batch.seed, family: batch.family }, spec);
    assert.deepEqual({ seed: keys[i].seed, family: keys[i].family }, spec);
    assert.equal(validateNativeBatch(batch).ok, true);
    assert.deepEqual(referenceLabels(batch), evaluatorLabels(batch));
    assert.deepEqual(referenceLabels(batch), keys[i].labels);
    const plane = normalizeBatch(batch);
    assert.equal(plane.grants.length, 13);
    assert.equal(Object.hasOwn(plane, 'labels'), false);
    assert.equal(
      plane.grants.some((grant) => Object.hasOwn(grant, 'authorized')),
      false,
    );
    const labels = Object.values(keys[i].labels);
    assert.equal(labels.filter((label) => label === 'malicious-missed-by-query').length, 3);
    assert.equal(labels.filter((label) => label === 'same-user-survivor').length, 9);
    assert.equal(labels.filter((label) => label === 'unauthorized-revoked').length, 1);
  }
});

test('restoring each changed registry fact reverses its malicious label', () => {
  for (const seed of SEEDS) {
    for (const family of FAMILIES) {
      const spec = { seed, family };
      const old = produceNativeBatch(spec);
      const candidate = produceNativeBatchV6(spec);
      const oldLabels = referenceLabels(old);
      const labels = referenceLabels(candidate);
      const changed = candidate.captures.filter(
        ({ grant }) =>
          oldLabels[grant.grant_id] === 'same-user-survivor' &&
          labels[grant.grant_id] === 'malicious-missed-by-query',
      );
      assert.equal(changed.length, 2);
      for (const capture of changed) {
        assert.equal(
          capture.registry.some(
            (entry) =>
              entryCovers(entry, capture.grant) && entryValidAt(entry, capture.grant.issue_time),
          ),
          false,
        );
        assert.equal(
          authorizedByJoin(capture.grant, capture.registry, capture.grant.issue_time),
          false,
        );
        const original = old.captures.find(
          (item) => item.grant.grant_id === capture.grant.grant_id,
        );
        const repaired = structuredClone(candidate);
        const target = repaired.captures.find(
          (item) => item.grant.grant_id === capture.grant.grant_id,
        );
        target.registry = structuredClone(original.registry);
        assert.equal(referenceLabels(repaired)[capture.grant.grant_id], 'same-user-survivor');
      }
    }
  }
});

test('survival, client-entry presence, all-malicious, and all-survivor shortcuts fail', () => {
  for (const seed of SEEDS) {
    for (const family of FAMILIES) {
      const batch = produceNativeBatchV6({ seed, family });
      const truth = referenceLabels(batch);
      const plane = normalizeBatch(batch);
      const grants = plane.grants;
      assert.equal(
        grants.some(
          (grant) => grant.accessed_post_reset && truth[grant.grant_id] === 'same-user-survivor',
        ),
        true,
      );
      assert.equal(
        grants.some(
          (grant) =>
            grant.accessed_post_reset && truth[grant.grant_id] === 'malicious-missed-by-query',
        ),
        true,
      );
      assert.equal(
        grants.some((grant) =>
          plane.registries.some(
            (record) =>
              record.capture_id === grant.capture_id &&
              record.entries.some((entry) => entry.client_or_app_selector === grant.client_id) &&
              truth[grant.grant_id] === 'malicious-missed-by-query',
          ),
        ),
        true,
      );
      assert.equal(
        Object.values(truth).every((label) => label === 'malicious-missed-by-query'),
        false,
      );
      assert.equal(
        Object.values(truth).every((label) => label === 'same-user-survivor'),
        false,
      );
    }
  }
});
