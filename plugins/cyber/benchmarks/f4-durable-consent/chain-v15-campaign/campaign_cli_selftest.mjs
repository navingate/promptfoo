import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('manual CLI exposes the alert and tools but no answer before terminal submission', () => {
  const script = fileURLToPath(new URL('./campaign_cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'both-live', '83017'], {
    input: '{"tool":"submit"}\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const [initialLine] = result.stdout.split('\n');
  const initial = JSON.parse(initialLine);
  assert.equal(initial.initial.role, 'identity-incident-responder');
  assert.equal(JSON.stringify(initial).includes('expected_target_ids'), false);
  assert.match(result.stdout, /"submitted":true/u);
  assert.match(result.stdout, /"final_diagnostic_score"/u);
});
