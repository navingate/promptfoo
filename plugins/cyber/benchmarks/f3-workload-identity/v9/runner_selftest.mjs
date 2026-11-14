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
  const modelOutput = path.join(temp, 'model-output.json');
  fs.writeFileSync(
    preload,
    `import fs from 'node:fs';
let calls = 0;
let initialCapture = null;
globalThis.fetch = async (_url, options) => {
  calls += 1;
  const request = JSON.parse(options.body);
  if (calls === 1) {
    try {
      const file = process.env.F3_MODEL_OUTPUT;
      initialCapture = {total: JSON.parse(fs.readFileSync(file, 'utf8')).summary.total,
        mode: fs.statSync(file).mode & 0o777};
    } catch {
      initialCapture = 'missing-or-invalid';
    }
  }
  fs.writeFileSync(process.env.F3_MODEL_OBSERVATION, JSON.stringify({calls, prompt: request.messages[0].content, initialCapture}));
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
      '--output',
      modelOutput,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        F3_MODEL_OBSERVATION: observation,
        F3_MODEL_OUTPUT: modelOutput,
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
  assert.deepEqual(seen.initialCapture, { total: 0, mode: 0o600 });
  assert.match(seen.prompt, /access point alias/i);
  assert.match(run.stdout, /turn-budget-exhausted/);

  const runCapture = (output, injectedPreload) =>
    spawnSync(
      process.execPath,
      [
        ...(injectedPreload ? ['--import', injectedPreload] : []),
        runner,
        '--version',
        'v9',
        '--mode',
        'offense',
        '--mock-reference',
        '--seeds',
        `${seed},${seed + 1}`,
        '--families',
        family,
        '--output',
        output,
      ],
      { encoding: 'utf8' },
    );
  const existing = path.join(temp, 'existing.json');
  fs.writeFileSync(existing, 'keep this file');
  fs.chmodSync(existing, 0o644);
  const existingRun = runCapture(existing);
  assert.notEqual(existingRun.status, 0);
  assert.equal(existingRun.stdout, '', 'existing output must fail before any reference world');
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep this file');
  assert.equal(fs.statSync(existing).mode & 0o777, 0o644);

  const linked = path.join(temp, 'linked.json');
  fs.symlinkSync(existing, linked);
  const linkedRun = runCapture(linked);
  assert.notEqual(linkedRun.status, 0);
  assert.equal(linkedRun.stdout, '', 'symlink output must fail before any reference world');
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep this file');

  const fresh = path.join(temp, 'fresh.json');
  const freshRun = runCapture(fresh);
  assert.equal(freshRun.status, 0, freshRun.stderr);
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
  const capture = JSON.parse(fs.readFileSync(fresh, 'utf8'));
  assert.equal(capture.summary.total, 2, 'iterative capture must retain both worlds');
  assert.equal(capture.summary.pass, 2);

  const restrictiveUmask = path.join(temp, 'restrictive-umask.mjs');
  fs.writeFileSync(restrictiveUmask, 'process.umask(0o277);\n');
  const restricted = path.join(temp, 'restricted.json');
  const restrictedRun = runCapture(restricted, restrictiveUmask);
  assert.equal(restrictedRun.status, 0, restrictedRun.stderr);
  assert.equal(fs.statSync(restricted).mode & 0o777, 0o600);

  const failurePreload = path.join(temp, 'fail-second-write.mjs');
  fs.writeFileSync(
    failurePreload,
    `import fs from 'node:fs';
const originalWrite = fs.writeSync;
fs.writeSync = (fd, buffer, ...args) => {
  if (Buffer.isBuffer(buffer) && buffer.toString('utf8').includes('"total": 2')) {
    throw new Error('injected-capture-write-failure');
  }
  return originalWrite(fd, buffer, ...args);
};
`,
  );
  const interrupted = path.join(temp, 'interrupted.json');
  const interruptedRun = runCapture(interrupted, failurePreload);
  assert.notEqual(interruptedRun.status, 0);
  assert.match(interruptedRun.stderr, /injected-capture-write-failure/);
  const prior = JSON.parse(fs.readFileSync(interrupted, 'utf8'));
  assert.equal(prior.summary.total, 1, 'failed second update must retain first complete world');
  assert.equal(prior.results.length, 1);
  assert.equal(fs.statSync(interrupted).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(temp).filter((entry) => entry.startsWith('.interrupted.json.tmp-')),
    [],
  );

  const renamePreload = path.join(temp, 'fail-second-rename.mjs');
  fs.writeFileSync(
    renamePreload,
    `import fs from 'node:fs';
const originalRename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (fs.readFileSync(from, 'utf8').includes('"total": 2')) {
    throw new Error('injected-capture-rename-failure');
  }
  return originalRename(from, to);
};
`,
  );
  const renameInterrupted = path.join(temp, 'rename-interrupted.json');
  const renameRun = runCapture(renameInterrupted, renamePreload);
  assert.notEqual(renameRun.status, 0);
  assert.match(renameRun.stderr, /injected-capture-rename-failure/);
  const beforeRename = JSON.parse(fs.readFileSync(renameInterrupted, 'utf8'));
  assert.equal(beforeRename.summary.total, 1);
  assert.equal(beforeRename.results.length, 1);
  assert.equal(fs.statSync(renameInterrupted).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(temp).filter((entry) => entry.startsWith('.rename-interrupted.json.tmp-')),
    [],
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('v9 runner self-test passed');
