import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceLabels } from '../chain-v4/capture.mjs';
import { produceNativeBatchV6 } from '../chain-v6/producer.mjs';
import { entryCovers, entryValidAt } from '../shared/estate.mjs';
import { produceNativeBatchV8 } from './producer.mjs';

test('v8 inserts one paired near-match row into each native survivor', () => {
  for (const family of [
    'tenant-boundary-filter',
    'incomplete-join',
    'audit-relationship-gap',
    'pagination-truncation',
  ]) {
    const spec = { seed: 16021, family };
    const old = produceNativeBatchV6(spec);
    const batch = produceNativeBatchV8(spec);
    assert.equal(batch.captures.length, 13);
    const oldById = new Map(old.captures.map((capture) => [capture.grant.grant_id, capture]));
    const labels = referenceLabels(batch);
    for (const capture of batch.captures) {
      const before = oldById.get(capture.grant.grant_id);
      assert.ok(before);
      assert.deepEqual(capture.grant, before.grant);
      assert.deepEqual(capture.remediation, before.remediation);
      assert.deepEqual(capture.events, before.events);
      const label = labels[capture.grant.grant_id];
      if (label === 'unauthorized-revoked') {
        assert.deepEqual(capture.registry, before.registry);
        continue;
      }
      assert.equal(before.registry.length, 3);
      assert.equal(capture.registry.length, 4);
      const oldIds = new Set(before.registry.map((entry) => entry.policy_entry_id));
      const added = capture.registry.filter((entry) => !oldIds.has(entry.policy_entry_id));
      assert.equal(added.length, 1);
      const row = added[0];
      const routeMatches = entryCovers(row, capture.grant);
      const timeMatches = entryValidAt(row, capture.grant.issue_time);
      assert.notEqual(routeMatches, timeMatches);
    }
  }
});
