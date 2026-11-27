#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { validateEventStream } from '../../v28/pilot-v1/events.mjs';
import { gradeCandidate } from './evaluate.mjs';
import { verifyFrozen } from './freeze.mjs';
import { CASE_ORDER, caseSpec, publicInput, sha256 } from './pilot.mjs';
import { preflight } from './preflight.mjs';
import { assertPrivateDirectory, inspect, permissionArgs } from './workdir.mjs';

const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
const preflightOnly = process.argv[4] === '--preflight-only';
assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
assert.ok([1, 2].includes(attempt));
assert.equal(process.argv.length, preflightOnly ? 5 : 4);
const frozen = await verifyFrozen();
const spec = caseSpec(index);
assert.equal(sha256(publicInput), frozen.input_sha256);
const cliVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(cliVersion, frozen.cli_version);
const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const ready = await preflight(index, true);
const { modelRoot, rawDirectory } = ready;
assertPrivateDirectory(modelRoot, '/private/tmp/f10v41-model-');
assertPrivateDirectory(rawDirectory, '/private/tmp/f10v41-raw-');
const workspace = path.join(modelRoot, 'cases/workspace');
assert.deepEqual(ready.staged, frozen.cases[index].staged);
assert.equal(ready.boundary.denied_count, 6);
assert.equal(ready.publicCheck.offline_install, true);
assert.equal(ready.publicCheck.public_check, true);
assert.equal(ready.inspected.sound, true);
assert.equal(ready.baseline.exact, false);
assert.equal(ready.baseline.evaluation_error, null);
if (preflightOnly) {
  process.stdout.write(
    `${JSON.stringify({ index, input_sha256: frozen.input_sha256, staged: ready.staged, boundary: ready.boundary, public_check: ready.publicCheck, baseline: ready.baseline })}\n`,
  );
  fs.rmSync(modelRoot, { recursive: true, force: true });
  fs.rmSync(rawDirectory, { recursive: true, force: true });
  process.exit(0);
}

const configArgs = permissionArgs(modelRoot, repositoryRoot);
const args = [
  'exec',
  '--ephemeral',
  '--ignore-user-config',
  '--skip-git-repo-check',
  '-C',
  workspace,
  '--model',
  frozen.model,
  '--cyber-access-program',
  frozen.requested_cyber_access_program,
  ...configArgs,
  '-c',
  `model_reasoning_effort="${frozen.reasoning_effort}"`,
  '--json',
  '-',
];
const launch = {
  schema_version: 'f10-v41-undici-pilot-launch-v1',
  source_commit: frozen.source_commit,
  manifest_sha256: sha256(
    fs.readFileSync(path.join(import.meta.dirname, 'evidence/manifest.json')),
  ),
  case_index: index,
  original_arm: spec.arm,
  attempt,
  input_sha256: frozen.input_sha256,
  staged: ready.staged,
  boundary: ready.boundary,
  public_check: ready.publicCheck,
  model: frozen.model,
  requested_cyber_access_program: frozen.requested_cyber_access_program,
  reasoning_effort: frozen.reasoning_effort,
  cli_version: cliVersion,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
const eventsPath = path.join(rawDirectory, 'events.jsonl');
const stderrPath = path.join(rawDirectory, 'stderr.txt');
const events = fs.createWriteStream(eventsPath, { mode: 0o600, flags: 'wx' });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600, flags: 'wx' });
process.stdout.write(`${rawDirectory}\n`);
const child = spawn('codex', args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
child.stderr.pipe(errors);
child.stdin.end(publicInput);
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
await Promise.all([finished(events), finished(errors)]);
const eventBytes = fs.readFileSync(eventsPath);
const eventValidation = validateEventStream(eventBytes.toString('utf8'));
const inspection = inspect(modelRoot, ready.staged);
let grade = null;
let evaluatorError = null;
if (exitCode === 0 && eventValidation.complete && inspection.sound) {
  try {
    grade = await gradeCandidate(modelRoot, spec.originalApplies);
    if (
      grade.install?.stderr_tail?.includes('sandbox_apply') ||
      grade.audit?.stderr_tail?.includes('sandbox_apply')
    ) {
      evaluatorError = 'evaluator-sandbox-apply-failed';
    }
  } catch (error) {
    evaluatorError = String(error);
  }
}
let status;
if (exitCode !== 0) {
  status = 'provider-or-cli-error';
} else if (!eventValidation.complete) {
  status = 'harness-or-transport-error';
} else if (!inspection.sound) {
  status = 'valid-conduct-failure';
  grade = { exact: false, valid: true, reason: inspection.reason };
} else if (evaluatorError) {
  status = 'harness-or-evaluator-error';
  grade = null;
} else {
  status = 'valid';
}
const response = eventValidation.final_message ?? '';
assertPrivateDirectory(rawDirectory, '/private/tmp/f10v41-raw-');
fs.writeFileSync(path.join(rawDirectory, 'response.txt'), response, { mode: 0o600, flag: 'wx' });
for (const name of ['publisher.mjs', 'package.json', 'package-lock.json', 'assessment.json']) {
  const source = path.join(workspace, name);
  if (fs.existsSync(source) && fs.lstatSync(source).isFile()) {
    assert.equal(fs.realpathSync(source), source, 'submitted-file-symlink');
    fs.copyFileSync(source, path.join(rawDirectory, `submitted-${name}`));
  }
}
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  status,
  event_validation: eventValidation,
  tool_items: eventValidation.tool_items,
  inspection,
  evaluator_error: evaluatorError,
  grade,
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  response_sha256: sha256(response),
  submitted_hashes: Object.fromEntries(
    ['publisher.mjs', 'package.json', 'package-lock.json', 'assessment.json']
      .filter((name) => fs.existsSync(path.join(rawDirectory, `submitted-${name}`)))
      .map((name) => [name, sha256(fs.readFileSync(path.join(rawDirectory, `submitted-${name}`)))]),
  ),
};
// The private arm and all raw metadata are saved only after the model exits.
fs.writeFileSync(path.join(rawDirectory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
fs.writeFileSync(path.join(rawDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
fs.rmSync(modelRoot, { recursive: true, force: true });
process.stdout.write(
  `${JSON.stringify({ directory: rawDirectory, status, exact: grade?.exact ?? null, tool_items: eventValidation.tool_items })}\n`,
);
