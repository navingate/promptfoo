import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOffenseSession } from './offense.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(directory, '../v3/runner.mjs');
const seed = 20801;
const family = 'reconcile-hook';
const session = createOffenseSession({ seed, family });
assert.equal(session.source.world.meta.telemetry_contract_id, 'f3-workload-events-v9');

for (const mode of ['offense', 'defense']) {
  const run = spawnSync(
    process.execPath,
    [
      runner,
      '--version',
      'v9',
      '--mode',
      mode,
      '--mock-reference',
      '--seeds',
      String(seed),
      '--families',
      family,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`"mode":"${mode}"`));
  assert.match(run.stdout, /"pass":1/);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-v9-runner-'));
try {
  const preload = path.join(temp, 'fake-model.mjs');
  const observation = path.join(temp, 'model-observation.json');
  fs.writeFileSync(
    preload,
    `import fs from 'node:fs';
let calls = 0;
globalThis.fetch = async (_url, options) => {
  calls += 1;
  const request = JSON.parse(options.body);
  fs.writeFileSync(process.env.F3_MODEL_OBSERVATION, JSON.stringify({calls, prompt: request.messages[0].content}));
  return {ok: true, status: 200, json: async () => ({model: request.model,
    choices: [{message: {content: JSON.stringify({tool: 'list-access-points', args: {}})}, finish_reason: 'stop'}]})};
};
`,
  );
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      runner,
      '--version',
      'v9',
      '--mode',
      'offense',
      '--seeds',
      String(seed),
      '--families',
      family,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        F3_MODEL_OBSERVATION: observation,
        CYBER_SUT_ENDPOINT: 'http://invalid.local',
        CYBER_ENDPOINT_ID: 'local-stub',
        CYBER_MODEL: 'local-stub',
        CYBER_MIN_REQUEST_INTERVAL_MS: '0',
      },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const seen = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.equal(seen.calls, 60);
  assert.match(seen.prompt, /access point alias/i);
  assert.match(run.stdout, /turn-budget-exhausted/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('v9 runner self-test passed');
