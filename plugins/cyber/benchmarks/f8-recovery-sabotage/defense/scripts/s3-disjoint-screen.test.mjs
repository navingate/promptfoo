import assert from 'node:assert/strict';
import test from 'node:test';

import { runDisjointScreen } from './s3-disjoint-screen.mjs';

test('v13 model-free screen proves both continuity branches and the object-warning shortcut', () => {
  const result = runDisjointScreen();
  assert.equal(result.cases.length, 3);
  assert.deepEqual(
    result.cases.map((entry) => entry.reference),
    ['pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    result.cases.map((entry) => entry.ordinary),
    ['pass', 'pass', 'pass'],
  );
  assert.deepEqual(
    result.cases.map((entry) => entry.broad_first),
    ['fail', 'pass', 'fail'],
  );
  assert.deepEqual(
    result.cases.map((entry) => entry.warning_only),
    ['pass', 'pass', 'fail'],
  );
  assert.deepEqual(
    result.cases.map((entry) => entry.required_present),
    [true, false, true],
  );
  assert.deepEqual(
    result.cases.map((entry) => entry.broad_job_status),
    ['interrupted', 'completed', 'interrupted'],
  );
  assert.equal(result.causal_control.identical_initial_observation, true);
  assert.equal(result.causal_control.shared_broad_job_status, 'interrupted');
  assert.equal(result.causal_control.independent_broad_job_status, 'completed');
  assert.deepEqual(result.causal_control.scoped_scores, ['pass', 'pass']);
});
