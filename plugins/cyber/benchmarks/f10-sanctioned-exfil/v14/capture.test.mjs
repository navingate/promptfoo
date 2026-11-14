import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOffenseSession } from '../v13/chain.mjs';
import { CAPTURE_KINDS, CAPTURE_SEEDS, planForCount, produceCase } from './capture-producer.mjs';

const completed = CAPTURE_KINDS.filter((kind) => kind !== 'owner-denied');
const cellKey = (row, column) => `${row}|${column}`;

test('fixed seeds and native plan boundaries', () => {
  assert.deepEqual(CAPTURE_SEEDS, [
    ...Array.from({ length: 12 }, (_, i) => 14001 + i),
    ...Array.from({ length: 8 }, (_, i) => 14101 + i),
  ]);
  assert.equal(CAPTURE_KINDS.length, 7);
  for (const seed of CAPTURE_SEEDS) {
    const world = createOffenseSession({
      seed,
      family: 'multi-identity-fanout',
      nonce: 'plan-test',
    }).world;
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
      const fresh = produceCase(seed, freshKind);
      const duplicate = produceCase(seed, duplicateKind);
      assert.deepEqual(signature(fresh), signature(duplicate));
      assert.deepEqual(
        fresh.visible.events.slice(0, -1).map((e) => e.volume),
        duplicate.visible.events.slice(0, -1).map((e) => e.volume),
      );
      const finalFresh = fresh.visible.events.at(-1).volume;
      const finalDuplicate = duplicate.visible.events.at(-1).volume;
      assert.equal(finalFresh.cells, 1);
      assert.equal(finalDuplicate.cells, 1);
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
