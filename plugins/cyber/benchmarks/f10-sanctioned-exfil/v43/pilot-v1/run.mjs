#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { validateEventStream } from '../../v28/pilot-v1/events.mjs';
import { acquireLaunch } from '../../v41/pilot-v1/ledger.mjs';
import { buildCliEnvironment } from './environment.mjs';
import { gradeCandidate } from './evaluate.mjs';
import { verifyFrozen } from './freeze.mjs';
import { CASE_ORDER, caseSpec, publicInput, sha256 } from './pilot.mjs';
import { preflight } from './preflight.mjs';
import { classifyTurn } from './run-state.mjs';
import { assertPrivateDirectory, inspect, permissionArgs } from './workdir.mjs';

const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
const preflightOnly = process.argv[4] === '--preflight-only';
assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
assert.ok([1, 2].includes(attempt));
assert.equal(process.argv.length, preflightOnly ? 5 : 4);

const frozen = verifyFrozen();
const spec = caseSpec(index);
assert.deepEqual(frozen.case_order, CASE_ORDER);
assert.equal(sha256(publicInput), frozen.input_sha256);
assert.equal(process.version, frozen.node_version);
assert.equal(execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), frozen.npm_version);
const modelEnvironment = buildCliEnvironment();
const cliVersion = execFileSync('codex', ['--version'], {
  encoding: 'utf8',
  env: modelEnvironment,
}).trim();
assert.equal(cliVersion, frozen.cli_version);
const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const ready = preflight(index, true);
const { modelRoot, rawDirectory } = ready;
const workspace = path.join(modelRoot, 'cases/workspace');
assertPrivateDirectory(modelRoot, '/private/tmp/f10v43-model-');
assertPrivateDirectory(rawDirectory, '/private/tmp/f10v43-raw-');
assert.deepEqual(ready.staged, frozen.cases[index].staged);
assert.equal(ready.boundary.denied_count, 6);
assert.equal(ready.publicCheck.worker_follow_loaded_by_axios, true);
assert.equal(ready.publicCheck.network_used, false);
assert.equal(ready.publicCheck.worker_follow_version, spec.originalApplies ? '1.15.5' : '1.15.6');
assert.equal(ready.inspected.sound, true);
assert.equal(ready.baseline.exact, false);
assert.equal(ready.baseline.business_continues, true);
if (preflightOnly) {
  process.stdout.write(
    `${JSON.stringify({ index, input_sha256: frozen.input_sha256, staged: ready.staged, boundary: ready.boundary, public_check: ready.publicCheck, baseline: ready.baseline })}\n`,
  );
  fs.rmSync(modelRoot, { recursive: true, force: true });
  fs.rmSync(rawDirectory, { recursive: true, force: true });
  process.exit(0);
}

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
  ...permissionArgs(modelRoot, repositoryRoot),
  '-c',
  `model_reasoning_effort="${frozen.reasoning_effort}"`,
  '--json',
  '-',
];
const manifestSha256 = sha256(
  fs.readFileSync(path.join(import.meta.dirname, 'evidence/manifest.json')),
);
const hostDirectory = path.join('/private/tmp', `f10v43-host-${manifestSha256.slice(0, 16)}`);
if (!fs.existsSync(hostDirectory)) {
  fs.mkdirSync(hostDirectory, { mode: 0o700 });
}
assertPrivateDirectory(hostDirectory, '/private/tmp/f10v43-host-');
const launch = {
  schema_version: 'f10-v43-follow-pilot-launch-v1',
  source_commit: frozen.source_commit,
  manifest_sha256: manifestSha256,
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
let reservation;
try {
  reservation = acquireLaunch(hostDirectory, {
    manifest_sha256: manifestSha256,
    index,
    attempt,
    input_sha256: frozen.input_sha256,
    staged_sha256: sha256(JSON.stringify(ready.staged)),
    started_at_utc: launch.started_at_utc,
  });
} catch (error) {
  fs.rmSync(modelRoot, { recursive: true, force: true });
  fs.rmSync(rawDirectory, { recursive: true, force: true });
  throw error;
}

const eventsPath = path.join(rawDirectory, 'events.jsonl');
const stderrPath = path.join(rawDirectory, 'stderr.txt');
const events = fs.createWriteStream(eventsPath, { mode: 0o600, flags: 'wx' });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600, flags: 'wx' });
process.stdout.write(`${rawDirectory}\n`);
const child = spawn('codex', args, {
  cwd: workspace,
  env: modelEnvironment,
  stdio: ['pipe', 'pipe', 'pipe'],
});
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
if (exitCode === 0 && eventValidation.complete && inspection.sound) {
  try {
    grade = gradeCandidate(workspace, spec.originalApplies);
  } catch (error) {
    grade = { exact: false, invalid_reason: 'evaluator_exception', detail: String(error) };
  }
}
const status = classifyTurn(exitCode, eventValidation, inspection, grade);
if (status === 'valid-conduct-failure') {
  grade = { exact: false, task_error: inspection.reason };
}
const response = eventValidation.final_message ?? '';
assertPrivateDirectory(rawDirectory, '/private/tmp/f10v43-raw-');
fs.writeFileSync(path.join(rawDirectory, 'response.txt'), response, { mode: 0o600, flag: 'wx' });
const submitted = [
  'assessment.json',
  'package.json',
  'package-lock.json',
  'worker/package.json',
  'worker/package-lock.json',
];
const submittedHashes = {};
if (inspection.sound) {
  for (const name of submitted) {
    const file = path.join(workspace, name);
    const bytes = fs.readFileSync(file);
    const output = `submitted-${name.replaceAll('/', '-')}`;
    fs.writeFileSync(path.join(rawDirectory, output), bytes, { mode: 0o600, flag: 'wx' });
    submittedHashes[name] = sha256(bytes);
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
  grade,
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  response_sha256: sha256(response),
  submitted_hashes: submittedHashes,
};
// Private arm and all raw metadata are saved only after model exit.
fs.writeFileSync(path.join(rawDirectory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
const summaryPath = path.join(rawDirectory, 'summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
reservation.finish({
  status,
  exact: grade?.exact ?? null,
  raw_directory: rawDirectory,
  summary_sha256: sha256(fs.readFileSync(summaryPath)),
  completed_at_utc: summary.completed_at_utc,
  material_harness_defect: status === 'harness-or-evaluator-error',
});
fs.rmSync(modelRoot, { recursive: true, force: true });
process.stdout.write(
  `${JSON.stringify({ directory: rawDirectory, status, exact: grade?.exact ?? null, tool_items: eventValidation.tool_items })}\n`,
);
