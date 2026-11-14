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
    resource: { dataset: 'warehouse.customers_pii' },
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
    publisher_profiles: [
      { profile_id: 'scheduled', actor_binding: 'alice' },
      { profile_id: 'alternate', actor_binding: 'alice' },
      { profile_id: 'bob-scheduled', actor_binding: 'bob' },
    ],
    events,
    receipts: events.map((event) => ({
      event_id: event.event_id,
      profile_id: event.actor.identity === 'bob' ? 'bob-scheduled' : profile,
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

test('missing event dataset is ambiguous rather than covered by policy fallback', () => {
  const capture = fixture();
  delete capture.events[0].resource.dataset;
  assert.deepEqual(detect(capture), { alice: 'ambiguous' });
});

test('missing receipt profile or publisher actor is ambiguous', () => {
  const missingProfile = fixture();
  delete missingProfile.receipts[0].profile_id;
  assert.deepEqual(detect(missingProfile), { alice: 'ambiguous' });

  const missingActor = fixture();
  delete missingActor.receipts[0].publisher_actor;
  assert.deepEqual(detect(missingActor), { alice: 'ambiguous' });
});

test('contradictory receipt publisher actor and profile binding are ambiguous', () => {
  const wrongActor = fixture();
  wrongActor.receipts[0].publisher_actor = 'bob';
  assert.deepEqual(detect(wrongActor), { alice: 'ambiguous' });

  const wrongProfile = fixture();
  wrongProfile.publisher_profiles = [{ profile_id: 'scheduled', actor_binding: 'bob' }];
  assert.deepEqual(detect(wrongProfile), { alice: 'ambiguous' });
});

test('missing or empty profile registry cannot authenticate receipt profile', () => {
  for (const profiles of [undefined, []]) {
    const capture = fixture();
    capture.publisher_profiles = profiles;
    assert.deepEqual(detect(capture), { alice: 'ambiguous' });
  }
});

test('cited job with invalid capacity is ambiguous', () => {
  for (const capacity of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const capture = fixture();
    capture.job_registry[0].approved_cell_volume = capacity;
    assert.deepEqual(detect(capture), { alice: 'ambiguous' });
  }
});

test('nonnumeric event time or arrival order is ambiguous', () => {
  for (const field of ['event_time', 'arrival_order']) {
    for (const value of ['1', Number.NaN, Number.POSITIVE_INFINITY]) {
      const capture = fixture();
      capture.events[0][field] = value;
      assert.deepEqual(detect(capture), { alice: 'ambiguous' });
    }
  }
});

test('later job skips already-covered cells without spending capacity', () => {
  const capture = fixture({
    cells: [
      [0, 'ssn'],
      [0, 'ssn'],
      [2, 'ssn'],
    ],
    cap: 1,
  });
  capture.job_registry.push({ ...capture.job_registry[0], job_id: 'job-2' });
  capture.events[1].job_ref = 'job-2';
  capture.events[2].actor.identity = 'alice';
  capture.receipts[2].publisher_actor = 'alice';
  capture.receipts[2].profile_id = 'scheduled';
  capture.events[2].job_ref = 'job-2';
  capture.flows = capture.flows.filter((flow) => flow.identity === 'alice');
  assert.deepEqual(detect(capture), { alice: 'sanctioned-bulk' });
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
  capture.receipts[0].profile_id = 'bob-scheduled';
  capture.flows.unshift({ flow_id: 'bob', identity: 'bob', destination: 'approved', window: 0 });
  capture.job_registry[0].actor_binding.push('bob');
  capture.job_registry[0].publisher_bindings.push({ actor: 'bob', profile_id: 'bob-scheduled' });
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
