import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOffenseSession } from '../v13/chain.mjs';
import { runExportPlane } from '../v13/estate.mjs';
import { produceCase } from '../v16/holdout-producer.mjs';
import { labelNative } from './authorization.mjs';

function native(kind) {
  const capture = produceCase(41001, kind, { nonce: 'v17-boundary', captureNonce: `v17-${kind}` });
  const session = createOffenseSession({
    ...capture.proof.spec,
    extraJobs: capture.proof.extraJobs,
  });
  const events = runExportPlane(capture.proof.native_actions, session.world).events;
  return labelNative(events, session.world.job_registry, session.world.policy).map(
    ({ label }) => label,
  );
}

test('a job bound to one actor does not sanction another actor delivering the same cell', () => {
  assert.deepEqual(native('covered-overlap'), ['sanctioned-bulk', 'benign']);
});

test('a nonexistent citation in a complete registry is unbound, not ambiguous', () => {
  assert.deepEqual(native('dangling-citation'), ['benign']);
});
