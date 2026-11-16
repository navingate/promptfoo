import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('manual staged CLI reveals the alert and control effects without pre-terminal answer', () => {
  const script = fileURLToPath(new URL('./staged_cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'both-live', '83017'], {
    input: '{"tool":"submit"}\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const initial = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(initial.initial.role, 'identity-incident-responder');
  assert.equal(JSON.stringify(initial).includes('expected_target_ids'), false);
  assert.equal(JSON.stringify(initial).includes('revocation_delay_ticks'), false);
  assert.match(result.stdout, /"submitted":true/u);
  assert.match(result.stdout, /"final_diagnostic_score"/u);
});
