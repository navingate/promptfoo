import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceCase as produceV14Case } from '../v14/capture-producer.mjs';
import { CAPTURE_SEEDS, produceCase } from './capture-producer.mjs';
import { scoreDefense } from './defense.mjs';
import * as shortcutModule from './defense-shortcuts.mjs';

const { SHORTCUT_RULES, shortcutLabels } = shortcutModule;

const rules = [
  'job-presence',
  'publisher-mismatch',
  'gross-volume',
  'uncovered-any',
  'profile-cap-gross',
  'v14-purpose-final-row-zero',
  'binding-final-row-zero',
  'fixed-row-one',
  'fixed-row-high',
  'row-rank-upper-half',
  'prior-min-row',
  'prior-max-row',
  'first-event-cell-equality',
  'first-event-row-equality',
];
const pairs = [
  ['alternate-over', 'alternate-boundary'],
  ['mixed-cap-cross', 'mixed-cap-safe'],
];

test('new controls are named and keep the five v14 baselines', () => {
  assert.deepEqual(SHORTCUT_RULES, rules);
});

test('v14 purpose and final-row shortcut reproduces the v14 labels', () => {
  const kinds = [
    'bound-bulk',
    'alternate-over',
    'alternate-boundary',
    'mixed-cap-safe',
    'mixed-cap-cross',
    'duplicate-covered',
  ];
  for (const seed of Array.from({ length: 12 }, (_, index) => 14001 + index)) {
    for (const kind of kinds) {
      const { visible, answer } = produceV14Case(seed, kind, {
        nonce: `v14-rule-${seed}-${kind}`,
        captureNonce: `v14-rule-${seed}-${kind}`,
      });
      assert.deepEqual(
        shortcutLabels({ captures: [visible] }, 'v14-purpose-final-row-zero'),
        answer.labels,
        `${seed}: ${kind}`,
      );
    }
  }
});

test('global binding and final-row shortcut reproduces all v14 completed labels', () => {
  for (const seed of Array.from({ length: 12 }, (_, index) => 14001 + index)) {
    for (const kind of [
      'bound-bulk',
      'alternate-over',
      'alternate-boundary',
      'mixed-cap-safe',
      'mixed-cap-cross',
      'duplicate-covered',
    ]) {
      const { visible, answer } = produceV14Case(seed, kind, {
        nonce: `v14-binding-rule-${seed}-${kind}`,
        captureNonce: `v14-binding-rule-${seed}-${kind}`,
      });
      assert.deepEqual(
        shortcutLabels({ captures: [visible] }, 'binding-final-row-zero'),
        answer.labels,
        `${seed}: ${kind}`,
      );
    }
  }
});

test('all row controls recognize globally bound events even with bounded purpose', () => {
  const seed = CAPTURE_SEEDS.find((candidate) => candidate % 2 === 0);
  const { visible, answer } = produceCase(seed, 'bound-bulk', {
    nonce: 'bound-row-control',
    captureNonce: 'bound-row-control',
  });
  const citedJob = visible.job_registry.find((job) => job.job_id === visible.events[0].job_ref);
  assert.equal(citedJob.purpose, 'bounded-migration');
  for (const rule of rules.slice(6)) {
    assert.deepEqual(shortcutLabels({ captures: [visible] }, rule), answer.labels, rule);
  }
});

test('fixed-row-one treats final row one as benign while binding-final-row-zero does not', () => {
  const { visible } = produceV14Case(14001, 'alternate-over', {
    nonce: 'fixed-row-one',
    captureNonce: 'fixed-row-one',
  });
  visible.events.at(-1).volume.row_ids = [1];
  assert.deepEqual(Object.values(shortcutLabels({ captures: [visible] }, 'fixed-row-one')), [
    'benign',
    'benign',
  ]);
  assert.deepEqual(
    Object.values(shortcutLabels({ captures: [visible] }, 'binding-final-row-zero')),
    ['cumulative-exfil', 'cumulative-exfil'],
  );
});

test('row controls classify v14 fresh and duplicate final events without deduplication', () => {
  const rowRules = rules.slice(6);
  const pair = ['alternate-over', 'alternate-boundary'].map((kind) =>
    produceV14Case(14001, kind, {
      nonce: 'v14-row-control-pair',
      captureNonce: `v14-row-control-${kind}`,
    }),
  );
  for (const rule of rowRules) {
    for (const { visible, answer } of pair) {
      assert.deepEqual(shortcutLabels({ captures: [visible] }, rule), answer.labels, rule);
    }
  }
});

test('first-event controls accept any row and column in the first actor event', () => {
  const { visible } = produceV14Case(14001, 'alternate-over', {
    nonce: 'first-event-membership',
    captureNonce: 'first-event-membership',
  });
  const finalEvent = visible.events.at(-1);
  const firstEvent = visible.events.find(
    (event) => event.actor.identity === finalEvent.actor.identity,
  );
  assert.ok(firstEvent.volume.row_ids.length > 1);
  assert.ok(firstEvent.volume.columns.length > 1);
  finalEvent.volume.row_ids = [firstEvent.volume.row_ids[1]];
  finalEvent.volume.columns = [firstEvent.volume.columns[1]];
  for (const rule of ['first-event-cell-equality', 'first-event-row-equality']) {
    assert.deepEqual(Object.values(shortcutLabels({ captures: [visible] }, rule)), [
      'benign',
      'benign',
    ]);
  }
});

test('first-event controls require an earlier actor event', () => {
  const { visible } = produceV14Case(14001, 'alternate-over', {
    nonce: 'first-event-no-prior',
    captureNonce: 'first-event-no-prior',
  });
  const finalEvent = visible.events.at(-1);
  visible.events = [finalEvent];
  visible.flows = visible.flows.filter((flow) => flow.identity === finalEvent.actor.identity);
  for (const rule of ['first-event-cell-equality', 'first-event-row-equality']) {
    assert.deepEqual(Object.values(shortcutLabels({ captures: [visible] }, rule)), [
      'cumulative-exfil',
    ]);
  }
});

test('no-dedup composite predicts paired fresh and duplicate cases identically', () => {
  for (const [fresh, duplicate] of pairs) {
    const captures = [fresh, duplicate].map((kind) =>
      produceCase(CAPTURE_SEEDS[0], kind, { nonce: `pair-${fresh}`, captureNonce: kind }),
    );
    const predicted = captures.map(({ visible }) =>
      Object.values(shortcutLabels({ captures: [visible] }, 'profile-cap-gross')),
    );
    assert.deepEqual(predicted[0], predicted[1]);
    assert.notDeepEqual(
      Object.values(captures[0].answer.labels),
      Object.values(captures[1].answer.labels),
    );
    assert.ok(
      captures.some(({ visible, answer }) =>
        Object.values(shortcutLabels({ captures: [visible] }, 'profile-cap-gross')).some(
          (label, index) => label !== Object.values(answer.labels)[index],
        ),
      ),
    );
  }
});

test('all shortcut controls return one four-class label per completed flow', () => {
  const captures = ['bound-bulk', ...pairs.flat(), 'duplicate-covered'].map(
    (kind) =>
      produceCase(CAPTURE_SEEDS[0], kind, {
        nonce: `control-${kind}`,
        captureNonce: `control-${kind}`,
      }).visible,
  );
  for (const rule of rules) {
    const labels = shortcutLabels({ captures }, rule);
    assert.equal(Object.keys(labels).length, 12);
    assert.ok(
      Object.values(labels).every((label) =>
        ['benign', 'sanctioned-bulk', 'cumulative-exfil', 'ambiguous'].includes(label),
      ),
    );
  }
  assert.throws(() => shortcutLabels({ captures }, 'unknown'), /unknown defense shortcut/u);
});

test('composite counts gross cells across events citing one job', () => {
  const capture = produceCase(CAPTURE_SEEDS[0], 'bound-bulk', {
    nonce: 'gross-cap',
    captureNonce: 'gross-cap',
  }).visible;
  const job = capture.job_registry.find((item) => item.job_id === capture.events[0].job_ref);
  job.approved_cell_volume = 40;
  assert.ok(capture.events.every((event) => event.volume.cells <= 40));
  assert.ok(capture.events.reduce((sum, event) => sum + event.volume.cells, 0) > 40);
  assert.deepEqual(Object.values(shortcutLabels({ captures: [capture] }, 'profile-cap-gross')), [
    'cumulative-exfil',
    'cumulative-exfil',
  ]);
});

test('pair exactness counts paired captures only when every flow matches the sidecar', () => {
  const produced = pairs.flatMap((pair) =>
    pair.map((kind) =>
      produceCase(CAPTURE_SEEDS[0], kind, {
        nonce: `pair-score-${pair[0]}`,
        captureNonce: `pair-score-${kind}`,
      }),
    ),
  );
  const labels = Object.assign({}, ...produced.map((item) => item.answer.labels));
  const batch = { captures: produced.map((item) => item.visible) };
  Object.defineProperty(batch, '_key', { value: new Map(Object.entries(labels)) });
  Object.defineProperty(batch, '_pairFlowIds', {
    value: new Map(produced.map((item) => [item.answer.kind, Object.keys(item.answer.labels)])),
  });
  assert.equal(shortcutModule.scorePairExact(batch, labels), 2);
  const withOneError = { ...labels, [Object.keys(produced[0].answer.labels)[0]]: 'benign' };
  assert.equal(shortcutModule.scorePairExact(batch, withOneError), 1);
});

test('each named shortcut is valid and fails exact scoring over development batches', () => {
  const developmentSeeds = CAPTURE_SEEDS.slice(12);
  const exactCounts = new Map(rules.map((rule) => [rule, 0]));
  for (const seed of developmentSeeds) {
    const pairNonce = new Map([
      ['alternate-over', `shortcut-dev-${seed}-alternate`],
      ['alternate-boundary', `shortcut-dev-${seed}-alternate`],
      ['mixed-cap-cross', `shortcut-dev-${seed}-mixed`],
      ['mixed-cap-safe', `shortcut-dev-${seed}-mixed`],
    ]);
    const produced = [
      'bound-bulk',
      'alternate-over',
      'alternate-boundary',
      'mixed-cap-safe',
      'mixed-cap-cross',
      'duplicate-covered',
      'owner-denied',
    ].map((kind) =>
      produceCase(seed, kind, {
        nonce: pairNonce.get(kind) ?? `shortcut-dev-${seed}-${kind}`,
        captureNonce: `shortcut-dev-${seed}-${kind}`,
      }),
    );
    for (const [fresh, duplicate] of pairs) {
      const freshCase = produced.find((item) => item.answer.kind === fresh);
      const duplicateCase = produced.find((item) => item.answer.kind === duplicate);
      assert.equal(freshCase.proof.spec.nonce, duplicateCase.proof.spec.nonce);
      assert.notEqual(freshCase.proof.captureNonce, duplicateCase.proof.captureNonce);
    }
    const batch = { seed, captures: produced.map((item) => item.visible) };
    Object.defineProperty(batch, '_key', {
      value: new Map(produced.flatMap((item) => Object.entries(item.answer.labels))),
    });
    for (const rule of rules) {
      const score = scoreDefense(batch, shortcutLabels(batch, rule));
      assert.equal(score.valid, true, `${seed}: ${rule}`);
      exactCounts.set(rule, exactCounts.get(rule) + Number(score.exact));
    }
  }
  for (const rule of rules) {
    assert.ok(exactCounts.get(rule) < developmentSeeds.length, `${rule}: exact on every batch`);
  }
});
