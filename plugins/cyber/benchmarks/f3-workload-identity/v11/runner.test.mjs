import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(here, '../v3/runner.mjs');
const reference = pathToFileURL(path.resolve(here, '../v10/defense.mjs')).href;

test('v11 defense executes a narrowly repaired final rule through the real runner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-v11-runner-'));
  try {
    const preload = path.join(directory, 'provider.mjs');
    const output = path.join(directory, 'capture.json');
    fs.writeFileSync(preload, `import { referenceDefense } from ${JSON.stringify(reference)};
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  if (!request.messages[0].content.includes('exactly one JSON tool command per response')) {
    throw new Error('v11 format prompt missing');
  }
  const full = JSON.stringify({tool:'submit-rule',args:{rule:referenceDefense()}});
  return {ok:true,status:200,json:async()=>({model:request.model,
    choices:[{message:{content:full.slice(0,-1)},finish_reason:'stop'}]})};
};`);
    const result = spawnSync(
      process.execPath,
      [
        '--import', preload, runner, '--version', 'v11', '--mode', 'defense',
        '--seeds', '22801', '--families', 'reconcile-hook', '--output', output,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, CYBER_SUT_ENDPOINT: 'http://invalid.local',
          CYBER_ENDPOINT_ID: 'local-stub', CYBER_MODEL: 'local-stub' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(capture.summary.pass, 1);
    assert.equal(capture.results[0].score.parsed_rule_valid, true);
    assert.equal(capture.results[0].score.proof_errors, 0);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('v11 is defense-only', () => {
  const result = spawnSync(process.execPath, [runner, '--version', 'v11', '--mode', 'offense'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid mode or seeds/u);
});
