import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../workflows/f4-v12-calibration.yml', import.meta.url);
const source = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';
const preflight = source.split(/^  preflight:\s*$/m)[1]?.split(/^  live:\s*$/m)[0] ?? '';
const live = source.split(/^  live:\s*$/m)[1] ?? '';

test('push is limited to the exact branch and all v12 task paths', () => {
  assert.match(source, /branches:\n\s+- codex\/f4-detection-rule-v10-candidate\n/);
  for (const path of [
    '.github/workflows/f4-v12-calibration.yml',
    '.github/scripts/f4-v12-calibration-report.mjs',
    '.github/scripts/f4-v12-calibration-report.test.mjs',
    '.github/scripts/f4-v12-calibration-workflow.test.mjs',
    'plugins/cyber/benchmarks/f4-durable-consent/chain-v12/**',
  ]) {
    assert.ok(source.includes(`- ${path}`), path);
  }
});

test('both jobs gate the exact repository, actor, branch, and same push SHA', () => {
  for (const job of [preflight, live]) {
    assert.match(job, /github\.repository == 'navingate\/promptfoo'/);
    assert.match(job, /github\.actor == 'navingate'/);
    assert.match(job, /github\.ref == 'refs\/heads\/codex\/f4-detection-rule-v10-candidate'/);
    assert.match(job, /timeout-minutes: \d+/);
    assert.match(job, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(job, /persist-credentials: false/);
  }
  assert.match(source, /permissions:\n\s+contents: read/);
  assert.equal(
    [...source.matchAll(/^\s+uses: [^\n]+$/gm)].every(([line]) => /@[a-f0-9]{40}\b/.test(line)),
    true,
  );
});

test('credential-free Linux preflight covers every v12 selftest and reporter gate', () => {
  assert.match(preflight, /runs-on: ubuntu-24\.04/);
  assert.match(preflight, /docker pull python@sha256:[a-f0-9]{64}/);
  assert.match(
    preflight,
    /node --test plugins\/cyber\/benchmarks\/f4-durable-consent\/chain-v12\/\*_selftest\.mjs/,
  );
  assert.match(preflight, /node --test \.github\/scripts\/f4-v12-calibration-\*\.test\.mjs/);
  assert.doesNotMatch(preflight, /secrets\.|CLOUDFLARE_API_KEY|CLOUDFLARE_OPENAI_BASE_URL/);
});

test('live gate makes three sequential no-retry calls with private files and encrypted-only uploads', () => {
  assert.match(live, /needs: preflight/);
  assert.match(live, /vars\.F4_V12_LIVE_ENABLED == 'true'/);
  assert.match(live, /github\.run_attempt == 1/);
  assert.match(live, /name: f4-v10-calibration/);
  assert.match(live, /for instance in a b c; do/);
  assert.equal((live.match(/chain-v12\/screen\.mjs/g) ?? []).length, 1);
  assert.match(live, /--instance "\$instance"/);
  assert.match(live, /--slot-assigned/);
  assert.match(live, /umask 077/);
  assert.match(live, /mkdir -m 700/);
  assert.match(live, /screen_status=\$\?/);
  assert.match(live, /f4-v12-calibration-report\.mjs/);
  assert.match(live, /if: always\(\)/);
  assert.match(live, /\/encrypted\/\*\.json/);
  assert.doesNotMatch(live, /\bcat\b|\btee\b|--retry|raw\.json\s*\n\s*if-no-files-found/);
  assert.equal((live.match(/secrets\.CLOUDFLARE_API_KEY/g) ?? []).length, 1);
  assert.equal((live.match(/secrets\.CLOUDFLARE_OPENAI_BASE_URL/g) ?? []).length, 1);
});
