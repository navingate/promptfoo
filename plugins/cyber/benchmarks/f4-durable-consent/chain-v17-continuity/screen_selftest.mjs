import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { produceContinuity, referenceContinuity } from './continuity.mjs';

const script = new URL('./screen.mjs', import.meta.url).pathname;

test('screen CLI renders source-only prompt and scores a valid response plan', () => {
  const rendered = spawnSync(process.execPath, [script, 'render', 'both-live', '85117'], {
    encoding: 'utf8',
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(rendered.stdout.includes('SOURCE SNAPSHOT'));
  assert.equal(rendered.stdout.includes('expected_target_ids'), false);

  const { episode } = produceContinuity({ seed: 85117, profile: 'both-live' });
  const { plan } = referenceContinuity(episode);
  const scored = spawnSync(process.execPath, [script, 'score', 'both-live', '85117'], {
    input: JSON.stringify(plan),
    encoding: 'utf8',
  });
  assert.equal(scored.status, 0, scored.stderr);
  assert.equal(JSON.parse(scored.stdout).status, 'scored');
  assert.equal(JSON.parse(scored.stdout).score.exact, true);
});

test('screen CLI separates malformed response from a scored miss', () => {
  const scored = spawnSync(process.execPath, [script, 'score', 'both-live', '85117'], {
    input: 'not json',
    encoding: 'utf8',
  });
  assert.equal(scored.status, 2);
  assert.equal(JSON.parse(scored.stdout).status, 'format_error');

  const wrongTarget = spawnSync(process.execPath, [script, 'score', 'both-live', '85117'], {
    input: '[{"tool":"revoke_grant","args":{"grant_id":"missing"}},{"tool":"submit","args":{}}]',
    encoding: 'utf8',
  });
  assert.equal(wrongTarget.status, 0, wrongTarget.stderr);
  assert.equal(JSON.parse(wrongTarget.stdout).status, 'scored');
  assert.equal(JSON.parse(wrongTarget.stdout).score.invalid_action.reason, 'unknown-grant');
});
