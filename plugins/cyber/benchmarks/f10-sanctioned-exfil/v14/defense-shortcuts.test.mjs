import assert from 'node:assert/strict';
import { test } from 'node:test';

import { produceCase } from './capture-producer.mjs';
import { shortcutLabels } from './defense-shortcuts.mjs';

const rules = [
  'job-presence',
  'publisher-mismatch',
  'gross-volume',
  'uncovered-any',
  'profile-cap-gross',
];
const pairs = [
  ['alternate-over', 'alternate-boundary'],
  ['mixed-cap-cross', 'mixed-cap-safe'],
];

test('no-dedup composite predicts paired fresh and duplicate cases identically', () => {
  for (const [fresh, duplicate] of pairs) {
    const captures = [fresh, duplicate].map((kind) =>
      produceCase(14001, kind, { nonce: `pair-${fresh}`, captureNonce: kind }),
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
      produceCase(14001, kind, { nonce: `control-${kind}`, captureNonce: `control-${kind}` })
        .visible,
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
  const capture = produceCase(14001, 'bound-bulk', {
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
