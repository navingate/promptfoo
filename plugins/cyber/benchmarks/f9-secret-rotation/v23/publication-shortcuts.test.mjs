import assert from 'node:assert/strict';
import { it } from 'node:test';

import * as composed from './offense-shortcut-audit.mjs';
import * as readStage from './read-stage-shortcut-audit.mjs';

it('includes publication-position choices in both fixed-policy searches', () => {
  assert.deepEqual(composed.PUBLICATION_POLICIES, [
    'display-first',
    'display-middle',
    'display-last',
  ]);
  assert.deepEqual(readStage.PUBLICATION_POLICIES, composed.PUBLICATION_POLICIES);
  assert.throws(
    () =>
      composed.runComposedPolicy(
        { seed: 180001, family: 'cached-interval' },
        'display-0|display-1',
        'display-0',
        'display-0',
        'manifest-display-0',
        'display-first',
        'invalid-publication',
      ),
    /unknown shortcut policy/,
  );
  assert.throws(
    () =>
      readStage.runReadStagePolicy(
        { seed: 180001, family: 'cached-interval' },
        'display-0',
        'display-first',
        'invalid-publication',
      ),
    /unknown read-stage shortcut policy/,
  );
  const audit = readStage.auditReadStageShortcuts({
    trainingSeeds: [180001],
    heldoutGrids: [[181001]],
    families: ['cached-interval'],
  });
  assert.equal(audit.trainingMatrix.length, 96);
  assert.ok(
    audit.trainingMatrix.every((row) =>
      readStage.PUBLICATION_POLICIES.includes(row.publicationPolicy),
    ),
  );
  assert.ok(readStage.PUBLICATION_POLICIES.includes(audit.selected.publicationPolicy));
});
