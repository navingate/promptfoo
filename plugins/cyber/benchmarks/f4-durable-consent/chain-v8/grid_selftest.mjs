import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  evaluatorLabels,
  normalizeBatch,
  referenceLabels,
  validateNativeBatch,
} from '../chain-v4/capture.mjs';
import { produceNativeBatchV6 } from '../chain-v6/producer.mjs';
import { entryCovers, entryValidAt, FAMILIES } from '../shared/estate.mjs';
import { generateCaptures, LABEL_PATH, NATIVE_PATH, SEEDS } from './generate-captures.mjs';
import { produceNativeBatchV8 } from './producer.mjs';

const MALICIOUS = 'malicious-missed-by-query';
const SURVIVOR = 'same-user-survivor';
const REVOKED = 'unauthorized-revoked';
const valid = (entry, grant) => entryCovers(entry, grant) && entryValidAt(entry, grant.issue_time);
const specs = () => SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));

function verifyMaliciousWitness(batch, capture, row, route) {
  const { grant } = capture;
  assert.equal(
    capture.registry.some((entry) => valid(entry, grant)),
    false,
  );
  const repaired = structuredClone(batch);
  const changed = repaired.captures.find((item) => item.grant.grant_id === grant.grant_id);
  const witness = changed.registry.find((entry) => entry.policy_entry_id === row.policy_entry_id);
  if (route) {
    witness.valid_until = grant.issue_time;
  } else {
    witness.approval_route_selector = grant.approval_route;
  }
  assert.equal(changed.registry.filter((entry) => valid(entry, grant)).length, 1);
  assert.equal(referenceLabels(repaired)[grant.grant_id], SURVIVOR);
}

function verifyAuthorizedRemoval(batch, capture) {
  const { grant } = capture;
  assert.equal(
    capture.registry.some((entry) => valid(entry, grant)),
    true,
  );
  const stripped = structuredClone(batch);
  const changed = stripped.captures.find((item) => item.grant.grant_id === grant.grant_id);
  for (const entry of changed.registry) {
    if (valid(entry, grant)) {
      entry.valid_until = grant.issue_time - 1;
    }
  }
  assert.equal(referenceLabels(stripped)[grant.grant_id], MALICIOUS);
}

test('fresh v8 grid has 36 independently exact, non-oracle native batches', () => {
  assert.deepEqual(SEEDS, [16021, 16022, 16023, 16024, 16025, 16026, 16027, 16028, 16029]);
  const generated = generateCaptures();
  assert.deepEqual([generated.batches, generated.records], [36, 468]);
  const batches = fs.readFileSync(NATIVE_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  const keys = fs.readFileSync(LABEL_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    assert.deepEqual(
      { seed: batch.seed, family: batch.family },
      {
        seed: SEEDS[Math.floor(i / 4)],
        family: FAMILIES[i % 4],
      },
    );
    assert.equal(validateNativeBatch(batch).ok, true);
    assert.deepEqual(referenceLabels(batch), evaluatorLabels(batch));
    assert.deepEqual(referenceLabels(batch), keys[i].labels);
    const plane = normalizeBatch(batch);
    assert.equal(plane.grants.length, 13);
    const visible = JSON.stringify(plane);
    for (const forbidden of [
      MALICIOUS,
      SURVIVOR,
      REVOKED,
      'authorized_by_join',
      '_attacker_created_this_run',
      'decoy',
    ]) {
      assert.equal(visible.includes(forbidden), false);
    }
    const labels = Object.values(keys[i].labels);
    assert.deepEqual(
      [MALICIOUS, SURVIVOR, REVOKED].map(
        (label) => labels.filter((value) => value === label).length,
      ),
      [3, 9, 1],
    );
  }
});

test('the new row alone flips all three malicious grants per batch', () => {
  const modes = { [MALICIOUS]: new Set(), [SURVIVOR]: new Set() };
  const positions = { [MALICIOUS]: new Set(), [SURVIVOR]: new Set() };
  const modeCounts = { [MALICIOUS]: { route: 0, time: 0 }, [SURVIVOR]: { route: 0, time: 0 } };
  const positionCounts = { [MALICIOUS]: [0, 0, 0, 0], [SURVIVOR]: [0, 0, 0, 0] };
  for (const spec of specs()) {
    const old = produceNativeBatchV6(spec);
    const batch = produceNativeBatchV8(spec);
    const labels = referenceLabels(batch);
    const before = new Map(old.captures.map((capture) => [capture.grant.grant_id, capture]));
    for (const capture of batch.captures) {
      const { grant } = capture;
      const label = labels[grant.grant_id];
      if (label === REVOKED) {
        assert.equal(capture.registry.length, 0);
        continue;
      }
      assert.equal(capture.registry.length, 4);
      const oldIds = new Set(
        before.get(grant.grant_id).registry.map((entry) => entry.policy_entry_id),
      );
      const added = capture.registry.filter((entry) => !oldIds.has(entry.policy_entry_id));
      assert.equal(added.length, 1);
      const row = added[0];
      const route = entryCovers(row, grant);
      const time = entryValidAt(row, grant.issue_time);
      assert.notEqual(route, time);
      const mode = route ? 'time' : 'route';
      const position = capture.registry.indexOf(row);
      modes[label].add(mode);
      positions[label].add(position);
      modeCounts[label][mode] += 1;
      positionCounts[label][position] += 1;
      if (label === MALICIOUS) {
        verifyMaliciousWitness(batch, capture, row, route);
      } else {
        assert.equal(label, SURVIVOR);
        verifyAuthorizedRemoval(batch, capture);
      }
    }
  }
  for (const label of [MALICIOUS, SURVIVOR]) {
    assert.deepEqual([...modes[label]].sort(), ['route', 'time']);
    assert.deepEqual([...positions[label]].sort(), [0, 1, 2, 3]);
    const total = modeCounts[label].route + modeCounts[label].time;
    assert.ok(Math.abs(modeCounts[label].route - modeCounts[label].time) <= total * 0.15);
    assert.ok(
      Math.max(...positionCounts[label]) - Math.min(...positionCounts[label]) <= total * 0.15,
    );
  }
});

test('near-match, row-position, and survival shortcuts fail', () => {
  const errors = { near: 0, first: 0, last: 0, survival: 0 };
  for (const spec of specs()) {
    const batch = produceNativeBatchV8(spec);
    const labels = referenceLabels(batch);
    for (const { grant, registry } of batch.captures) {
      const truth = labels[grant.grant_id];
      if (![MALICIOUS, SURVIVOR].includes(truth)) {
        continue;
      }
      const predicted = (entry) => (valid(entry, grant) ? SURVIVOR : MALICIOUS);
      errors.near += SURVIVOR === truth ? 0 : 1;
      errors.first += predicted(registry[0]) === truth ? 0 : 1;
      errors.last += predicted(registry.at(-1)) === truth ? 0 : 1;
      errors.survival += (grant.accessed_post_reset ? MALICIOUS : SURVIVOR) === truth ? 0 : 1;
    }
  }
  for (const count of Object.values(errors)) {
    assert.ok(count > 0);
  }
});
