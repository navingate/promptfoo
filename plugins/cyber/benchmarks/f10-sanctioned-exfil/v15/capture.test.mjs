import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOffenseSession } from '../v13/chain.mjs';
import {
  CAPTURE_KINDS,
  CAPTURE_SEEDS,
  planForCount,
  produceCase,
  verifyNativeProof,
} from './capture-producer.mjs';

const completed = CAPTURE_KINDS.filter((kind) => kind !== 'owner-denied');
const cellKey = (row, column) => `${row}|${column}`;

test('fixed seeds and native plan boundaries', () => {
  assert.deepEqual(
    CAPTURE_SEEDS,
    [
      31001, 31002, 31004, 31005, 31006, 31007, 31008, 31009, 31010, 31011, 31012, 31013, 31014,
      31015, 31016, 31017, 31018, 31019, 31021, 31022,
    ],
  );
  assert.equal(CAPTURE_KINDS.length, 7);
  for (const seed of CAPTURE_SEEDS) {
    const world = createOffenseSession({
      seed,
      family: 'multi-identity-fanout',
      nonce: 'plan-test',
    }).world;
    assert.throws(() => planForCount(world, 2));
    assert.throws(() => planForCount(world, 3));
    for (const count of [
      world.policy.cumulative_aggregate_limit + 1,
      world.policy.cumulative_aggregate_limit + 3,
    ]) {
      const plan = planForCount(world, count);
      assert.equal(
        new Set(plan.flatMap((a) => a.row_ids.flatMap((r) => a.columns.map((c) => cellKey(r, c)))))
          .size,
        count,
      );
      assert.equal(new Set(plan.map((a) => a.identity)).size, 2);
      assert.ok(
        plan.every(
          (a) => a.row_ids.length * a.columns.length <= world.policy.per_action_cell_limit,
        ),
      );
    }
  }
});

test('each seed has six native two-flow cases, a denied case, and balanced truth', () => {
  for (const seed of CAPTURE_SEEDS) {
    const counts = { 'cumulative-exfil': 0, 'sanctioned-bulk': 0, benign: 0 };
    for (const kind of completed) {
      const { visible, answer, proof } = produceCase(seed, kind);
      assert.equal(visible.flows.length, 2, `${seed} ${kind}`);
      assert.equal(Object.keys(answer.labels).length, 2);
      assert.equal(visible.events.length, visible.receipts.length);
      assert.equal(proof.sink.length, visible.receipts.length);
      assert.equal(proof.score.checks.payload_ok, true);
      for (const label of Object.values(answer.labels)) {
        counts[label] += 1;
      }
      for (const receipt of visible.receipts) {
        const event = visible.events.find((item) => item.event_id === receipt.event_id);
        const stage = visible.stages.find((item) => item.stage_ref === receipt.stage_ref);
        assert.ok(event && stage);
        assert.equal(stage.report_ref, receipt.report_ref);
        assert.equal(stage.report_owner, receipt.report_owner);
        assert.equal(event.actor.identity, receipt.publisher_actor);
        assert.equal(receipt.cell_count, stage.cell_count);
        assert.equal(
          visible.publisher_profiles.find((p) => p.profile_id === receipt.profile_id)
            ?.actor_binding,
          receipt.publisher_actor,
        );
      }
    }
    assert.deepEqual(counts, { 'cumulative-exfil': 4, 'sanctioned-bulk': 4, benign: 4 });
    const denied = produceCase(seed, 'owner-denied');
    assert.equal(denied.visible.flows.length, 0);
    assert.equal(denied.visible.events.length, 0);
    assert.equal(denied.proof.sink.length, 0);
    assert.equal(denied.visible.blocked_publish_attempts[0].reason, 'publisher-owner-mismatch');
  }
});

test('capture IDs use private entropy and explicit nonces replay native receipts', () => {
  const first = produceCase(31001, 'bound-bulk');
  const second = produceCase(31001, 'bound-bulk');
  assert.notEqual(first.visible.capture_id, second.visible.capture_id);
  assert.notEqual(first.proof.spec.nonce, second.proof.spec.nonce);
  assert.notEqual(first.proof.captureNonce, second.proof.captureNonce);
  assert.equal(first.visible.captureNonce, undefined);
  const options = { nonce: 'shared-native-nonce', captureNonce: 'private-capture-nonce' };
  const replay = produceCase(31001, 'bound-bulk', options);
  assert.deepEqual(replay, produceCase(31001, 'bound-bulk', options));
  assert.equal(replay.proof.spec.nonce, options.nonce);
  assert.equal(replay.proof.captureNonce, options.captureNonce);
});

test('job purpose depends only on seed parity across all capture kinds', () => {
  for (const seeds of [CAPTURE_SEEDS.slice(0, 12), CAPTURE_SEEDS.slice(12)]) {
    const labelsByPurpose = new Map();
    for (const seed of seeds) {
      const expected = seed % 2 ? 'scheduled-migration' : 'bounded-migration';
      for (const kind of completed) {
        const { visible, answer } = produceCase(seed, kind, {
          nonce: `purpose-${seed}-${kind}`,
          captureNonce: `purpose-capture-${seed}-${kind}`,
        });
        const job = visible.job_registry.find((item) => item.job_id === visible.events[0].job_ref);
        assert.equal(job?.purpose, expected, `${seed} ${kind}`);
        const labels = labelsByPurpose.get(expected) ?? new Set();
        for (const label of Object.values(answer.labels)) {
          labels.add(label);
        }
        labelsByPurpose.set(expected, labels);
      }
    }
    assert.deepEqual([...labelsByPurpose.keys()].sort(), [
      'bounded-migration',
      'scheduled-migration',
    ]);
    for (const labels of labelsByPurpose.values()) {
      assert.deepEqual(labels, new Set(['sanctioned-bulk', 'cumulative-exfil', 'benign']));
    }
  }
});

test('completed exports cite the intended job, with publisher and actor binding mismatches preserved', () => {
  for (const seed of CAPTURE_SEEDS) {
    for (const kind of completed) {
      const { visible } = produceCase(seed, kind);
      const job = visible.job_registry.find(
        (item) =>
          item.job_id.startsWith('job-') && item.destination === visible.events[0].destination,
      );
      assert.ok(job, `${seed} ${kind}`);
      for (const event of visible.events) {
        assert.equal(event.job_ref, job.job_id, `${seed} ${kind} ${event.event_id}`);
      }
      if (kind.startsWith('alternate-')) {
        for (const receipt of visible.receipts) {
          const binding = job.publisher_bindings.find(
            (item) => item.actor === receipt.publisher_actor,
          );
          assert.ok(binding);
          assert.notEqual(receipt.profile_id, binding.profile_id);
          assert.equal(
            visible.publisher_profiles.find((item) => item.profile_id === receipt.profile_id)
              ?.actor_binding,
            receipt.publisher_actor,
          );
        }
      }
      if (kind.startsWith('mixed-cap-')) {
        const actor1 = visible.flows[1].identity;
        assert.ok(!job.actor_binding.includes(actor1));
        assert.ok(!job.publisher_bindings.some((item) => item.actor === actor1));
        assert.ok(
          visible.receipts.some(
            (receipt) =>
              receipt.publisher_actor === actor1 &&
              receipt.profile_id !== job.publisher_bindings[0].profile_id,
          ),
        );
      }
    }
  }
});

function signature(capture) {
  const { visible } = capture;
  return {
    actors: visible.events.map((e) => e.actor.identity),
    profiles: visible.receipts.map((r) => r.profile_id),
    caps: visible.job_registry.map((j) => j.approved_cell_volume),
    sizes: visible.events.map((e) => e.volume.cells),
    gross: visible.events.reduce((sum, e) => sum + e.volume.cells, 0),
  };
}

test('paired cases differ only in final cell overlap and labels', () => {
  for (const seed of CAPTURE_SEEDS) {
    for (const [freshKind, duplicateKind] of [
      ['alternate-over', 'alternate-boundary'],
      ['mixed-cap-cross', 'mixed-cap-safe'],
    ]) {
      const nonce = `paired-native-${seed}-${freshKind}`;
      const fresh = produceCase(seed, freshKind, {
        nonce,
        captureNonce: `private-fresh-${seed}-${freshKind}`,
      });
      const duplicate = produceCase(seed, duplicateKind, {
        nonce,
        captureNonce: `private-duplicate-${seed}-${duplicateKind}`,
      });
      assert.notEqual(fresh.visible.capture_id, duplicate.visible.capture_id);
      for (const field of ['report_ref', 'stage_ref', 'receipt_id']) {
        assert.deepEqual(
          fresh.visible.receipts.slice(0, -1).map((receipt) => receipt[field]),
          duplicate.visible.receipts.slice(0, -1).map((receipt) => receipt[field]),
        );
      }
      assert.deepEqual(signature(fresh), signature(duplicate));
      assert.deepEqual(
        fresh.visible.events.slice(0, -1).map((e) => e.volume),
        duplicate.visible.events.slice(0, -1).map((e) => e.volume),
      );
      const finalFresh = fresh.visible.events.at(-1).volume;
      const finalDuplicate = duplicate.visible.events.at(-1).volume;
      assert.equal(finalFresh.cells, 1);
      assert.equal(finalDuplicate.cells, 1);
      assert.deepEqual(finalFresh.columns, finalDuplicate.columns);
      const prior = new Set(
        duplicate.visible.events
          .slice(0, -1)
          .flatMap((e) =>
            e.volume.row_ids.flatMap((r) => e.volume.columns.map((c) => cellKey(r, c))),
          ),
      );
      assert.ok(prior.has(cellKey(finalDuplicate.row_ids[0], finalDuplicate.columns[0])));
      assert.ok(!prior.has(cellKey(finalFresh.row_ids[0], finalFresh.columns[0])));
      assert.deepEqual(new Set(Object.values(fresh.answer.labels)), new Set(['cumulative-exfil']));
      assert.deepEqual(new Set(Object.values(duplicate.answer.labels)), new Set(['benign']));
    }
  }
});

test('paired final cells use seed-varied actor-one candidates outside the first action when possible', () => {
  const chosenPositions = new Set();
  const selectedColumns = new Set();
  for (const seed of CAPTURE_SEEDS) {
    for (const [freshKind, duplicateKind] of [
      ['alternate-over', 'alternate-boundary'],
      ['mixed-cap-cross', 'mixed-cap-safe'],
    ]) {
      const nonce = `candidate-${seed}-${freshKind}`;
      const fresh = produceCase(seed, freshKind, { nonce, captureNonce: `fresh-${seed}` });
      const duplicate = produceCase(seed, duplicateKind, {
        nonce,
        captureNonce: `duplicate-${seed}`,
      });
      const actorOne = duplicate.proof.plan.at(-1).identity;
      const priorActorActions = duplicate.proof.plan
        .slice(0, -1)
        .filter((action) => action.identity === actorOne);
      const column = duplicate.proof.plan.at(-1).columns[0];
      const duplicateRow = duplicate.proof.plan.at(-1).row_ids[0];
      const freshRow = fresh.proof.plan.at(-1).row_ids[0];
      const priorRows = priorActorActions
        .filter((action) => action.columns.includes(column))
        .flatMap((action) => action.row_ids);
      const firstActionRows = priorActorActions[0].columns.includes(column)
        ? priorActorActions[0].row_ids
        : [];
      assert.deepEqual(fresh.proof.plan.at(-1).columns, [column]);
      assert.ok(priorRows.includes(duplicateRow), `${seed} ${duplicateKind}`);
      assert.ok(!priorRows.includes(freshRow), `${seed} ${freshKind}`);
      if (priorRows.some((row) => !firstActionRows.includes(row))) {
        assert.ok(!firstActionRows.includes(duplicateRow), `${seed} ${duplicateKind}`);
      }
      chosenPositions.add(priorRows.indexOf(duplicateRow));
      selectedColumns.add(column);
    }
  }
  assert.ok(chosenPositions.size >= 3);
  assert.ok(selectedColumns.size >= 2);
});

test('pair-shared nonce applies a stable injective row mapping to every base action', () => {
  let changedFromUnpermuted = false;
  for (const seed of CAPTURE_SEEDS) {
    for (const [freshKind, duplicateKind] of [
      ['alternate-over', 'alternate-boundary'],
      ['mixed-cap-cross', 'mixed-cap-safe'],
    ]) {
      const nonce = `permutation-${seed}-${freshKind}`;
      const fresh = produceCase(seed, freshKind, { nonce, captureNonce: `fresh-${seed}` });
      const duplicate = produceCase(seed, duplicateKind, {
        nonce,
        captureNonce: `duplicate-${seed}`,
      });
      const world = createOffenseSession({
        seed,
        family: 'multi-identity-fanout',
        nonce,
      }).world;
      const baseCount =
        freshKind === 'alternate-over'
          ? world.policy.cumulative_aggregate_limit
          : world.policy.cumulative_aggregate_limit + 3;
      const basePlan = planForCount(world, baseCount);
      assert.deepEqual(fresh.proof.plan.slice(0, -1), duplicate.proof.plan.slice(0, -1));
      const mappings = new Map();
      for (const [index, original] of basePlan.entries()) {
        const actual = fresh.proof.plan[index];
        assert.equal(actual.identity, original.identity);
        assert.deepEqual(actual.columns, original.columns);
        const mapping = mappings.get(original.identity) ?? new Map();
        mappings.set(original.identity, mapping);
        for (const [rowIndex, oldRow] of original.row_ids.entries()) {
          const newRow = actual.row_ids[rowIndex];
          const scope = world.identities.find(
            (item) => item.identity === original.identity,
          ).access_scope;
          assert.ok(newRow >= 0 && newRow < scope.rows);
          assert.equal(mapping.get(oldRow) ?? newRow, newRow);
          mapping.set(oldRow, newRow);
          changedFromUnpermuted ||= oldRow !== newRow;
        }
      }
      for (const mapping of mappings.values()) {
        assert.equal(new Set(mapping.values()).size, mapping.size);
      }
    }
  }
  assert.ok(changedFromUnpermuted);
  const first = produceCase(31001, 'alternate-over', {
    nonce: 'first-permutation-nonce',
    captureNonce: 'first-private-capture',
  });
  const second = produceCase(31001, 'alternate-over', {
    nonce: 'second-permutation-nonce',
    captureNonce: 'second-private-capture',
  });
  assert.notDeepEqual(
    first.proof.plan.map((action) => action.row_ids),
    second.proof.plan.map((action) => action.row_ids),
  );
});

test('native sink proof replays the permuted actions and receipts', () => {
  for (const seed of CAPTURE_SEEDS) {
    for (const kind of CAPTURE_KINDS) {
      const { proof } = produceCase(seed, kind, {
        nonce: `proof-${seed}-${kind}`,
        captureNonce: `proof-capture-${seed}-${kind}`,
      });
      assert.equal(verifyNativeProof(proof), true);
    }
  }
});

test('both publisher principals serve both actors across seeds', () => {
  const positions = [new Set(), new Set()];
  for (const seed of CAPTURE_SEEDS) {
    const capture = produceCase(seed, 'bound-bulk').visible;
    for (let actor = 0; actor < 2; actor += 1) {
      const identity = capture.flows[actor].identity;
      const receipt = capture.receipts.find((r) => r.publisher_actor === identity);
      positions[actor].add(
        capture.publisher_profiles.find((p) => p.profile_id === receipt.profile_id).principal,
      );
    }
  }
  assert.equal(positions[0].size, 2);
  assert.equal(positions[1].size, 2);
});
