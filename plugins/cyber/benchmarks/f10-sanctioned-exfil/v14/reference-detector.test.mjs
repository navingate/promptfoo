import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CAPTURE_KINDS, CAPTURE_SEEDS, produceCase } from './capture-producer.mjs';
import { referenceDefense } from './defense.mjs';
import { detect } from './reference-detector.mjs';

function fixture({
  cells = [[0, 'ssn']],
  cap = 1,
  limit = 0,
  profile = 'scheduled',
  jobActors = ['alice'],
  jobProfiles = [{ actor: 'alice', profile_id: 'scheduled' }],
} = {}) {
  const events = cells.map(([row, column], i) => ({
    event_id: `event-${i}`,
    actor: { identity: i === 2 ? 'bob' : 'alice' },
    destination: 'approved',
    event_time: 1,
    arrival_order: i,
    job_ref: 'job',
    volume: { row_ids: [row], columns: [column], cells: 1 },
  }));
  return {
    policy: {
      dataset: 'warehouse.customers_pii',
      window_size: 300,
      cumulative_aggregate_limit: limit,
    },
    catalog: { protected_columns: ['ssn', 'dob'] },
    job_registry: [
      {
        job_id: 'job',
        dataset: 'warehouse.customers_pii',
        destination: 'approved',
        window: 0,
        approved_cell_volume: cap,
        actor_binding: jobActors,
        publisher_bindings: jobProfiles,
      },
    ],
    events,
    receipts: events.map((event) => ({
      event_id: event.event_id,
      profile_id: profile,
      publisher_actor: event.actor.identity,
    })),
    flows: [...new Set(events.map((event) => event.actor.identity))].map((identity) => ({
      flow_id: identity,
      identity,
      destination: 'approved',
      window: 0,
    })),
  };
}

test('actual receipt profile controls coverage', () => {
  assert.deepEqual(detect(fixture({ profile: 'alternate' })), { alice: 'cumulative-exfil' });
});

test('job cap covers only canonical distinct cells', () => {
  const capture = fixture({
    cells: [
      [1, 'ssn'],
      [0, 'dob'],
    ],
    cap: 1,
  });
  assert.deepEqual(detect(capture), { alice: 'cumulative-exfil' });
  capture.events[0].actor.identity = 'bob';
  capture.receipts[0].publisher_actor = 'bob';
  capture.flows.unshift({ flow_id: 'bob', identity: 'bob', destination: 'approved', window: 0 });
  capture.job_registry[0].actor_binding.push('bob');
  capture.job_registry[0].publisher_bindings.push({ actor: 'bob', profile_id: 'scheduled' });
  assert.deepEqual(detect(capture), { bob: 'cumulative-exfil', alice: 'sanctioned-bulk' });
});

test('duplicate replay consumes one capacity slot', () => {
  assert.deepEqual(
    detect(
      fixture({
        cells: [
          [0, 'ssn'],
          [0, 'ssn'],
        ],
        cap: 1,
      }),
    ),
    { alice: 'sanctioned-bulk' },
  );
});

test('cross-actor uncovered union crosses aggregate even when each actor stays below it', () => {
  const capture = fixture({
    cells: [
      [0, 'ssn'],
      [1, 'ssn'],
      [2, 'ssn'],
    ],
    cap: 0,
    limit: 2,
  });
  assert.deepEqual(detect(capture), { alice: 'cumulative-exfil', bob: 'cumulative-exfil' });
});

test('ambiguity takes precedence over zero cells and crossing', () => {
  const capture = fixture({ cells: [[0, 'ssn']], cap: 0 });
  delete capture.events[0].arrival_order;
  assert.deepEqual(detect(capture), { alice: 'ambiguous' });
  capture.events[0].volume.columns = ['public'];
  assert.deepEqual(detect(capture), { alice: 'ambiguous' });
});

test('all producer cases match native evaluator truth and reference batch output', () => {
  for (const seed of CAPTURE_SEEDS) {
    const captures = CAPTURE_KINDS.map((kind) => produceCase(seed, kind));
    for (const { visible, answer } of captures) {
      assert.deepEqual(detect(visible), answer.labels, `${seed} ${answer.kind}`);
    }
    const batch = { captures: captures.map(({ visible }) => visible) };
    assert.deepEqual(
      referenceDefense(batch),
      Object.assign({}, ...captures.map(({ answer }) => answer.labels)),
    );
  }
});
