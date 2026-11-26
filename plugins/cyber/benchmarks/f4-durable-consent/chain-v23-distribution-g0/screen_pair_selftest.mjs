import assert from 'node:assert/strict';
import { test } from 'node:test';

const { runScreen } = await import('./screen_pair.mjs');

test('screen records two exact visible-only references and failed shortcuts', () => {
  const screen = runScreen();
  assert.equal(screen.version, 'f4-distribution-v23-response-pair-model-free');
  assert.equal(screen.model_calls, 0);
  assert.deepEqual(
    screen.reference.map((row) => row.exact),
    [true, true],
  );
  assert.deepEqual(
    screen.shortcuts.map((row) => row.exact),
    [false, false, false],
  );
  assert.deepEqual(screen.reference[0].alert, screen.reference[1].alert);
  assert.equal(JSON.stringify(screen).includes('F4_INERT_EXPORT_MARKER'), false);
});
