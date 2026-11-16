import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../workflows/f4-v12-jsonquote-replay.yml', import.meta.url);
const source = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';
const preflight = source.split(/^  preflight:\s*$/m)[1]?.split(/^  replay:\s*$/m)[0] ?? '';
const replay = source.split(/^  replay:\s*$/m)[1] ?? '';

test('diagnostic workflow is restricted to the F4 branch and exact trigger paths', () => {
  assert.match(source, /branches:\n\s+- codex\/f4-detection-rule-v10-candidate\n/);
  for (const file of [
    '.github/workflows/f4-v12-jsonquote-replay.yml',
    '.github/scripts/f4-v12-jsonquote-workflow.test.mjs',
    'plugins/cyber/benchmarks/f4-durable-consent/chain-v12/diagnostics/**',
  ]) {
    assert.ok(source.includes(`- ${file}`), file);
  }
  assert.equal(
    [...source.matchAll(/^\s+uses: [^\n]+$/gm)].every(([line]) => /@[a-f0-9]{40}\b/u.test(line)),
    true,
  );
});

test('preflight is credential free and checks the frozen original plus replay implementation', () => {
  for (const job of [preflight, replay]) {
    assert.match(job, /github\.repository == 'navingate\/promptfoo'/);
    assert.match(job, /github\.actor == 'navingate'/);
    assert.match(job, /github\.ref == 'refs\/heads\/codex\/f4-detection-rule-v10-candidate'/);
    assert.match(job, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(job, /persist-credentials: false/);
    assert.match(job, /timeout-minutes: \d+/);
  }
  assert.match(preflight, /docker pull python@sha256:[a-f0-9]{64}/);
  assert.match(
    preflight,
    /node --test plugins\/cyber\/benchmarks\/f4-durable-consent\/chain-v12\/\*_selftest\.mjs/,
  );
  assert.match(preflight, /jsonquote_replay_selftest\.mjs/);
  assert.match(preflight, /f4-v12-jsonquote-workflow\.test\.mjs/);
  assert.doesNotMatch(preflight, /secrets\.|F4_V12_REPLAY_SQL/);
});

test('replay requires one exact SHA and cannot call a model', () => {
  assert.match(replay, /needs: preflight/);
  assert.match(replay, /github\.run_attempt == 1/);
  assert.match(replay, /vars\.F4_V12_JSONQUOTE_REPLAY_ENABLED == 'true'/);
  assert.match(replay, /vars\.F4_V12_JSONQUOTE_REPLAY_SHA == github\.sha/);
  assert.match(replay, /name: f4-v10-calibration/);
  assert.equal((replay.match(/secrets\.F4_V12_REPLAY_SQL/gu) ?? []).length, 1);
  assert.equal((replay.match(/jsonquote_replay\.mjs/gu) ?? []).length, 1);
  assert.doesNotMatch(replay, /CLOUDFLARE_API_KEY|chat\/completions|--retry|\bcat\b|\btee\b/);
});
