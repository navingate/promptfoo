#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { validateEventStream } from '../../v28/pilot-v1/events.mjs';
import { gradeSubmittedWorker } from './broker.mjs';
import { classifyRun } from './classify.mjs';
import { verifyFrozen } from './freeze.mjs';
import { buildPilotCase, CASE_ORDER } from './pilot.mjs';
import {
  createRunDirectories,
  inspectModelDirectory,
  permissionConfigArgs,
  probePublicValidator,
  probeReadBoundary,
  stageModelDirectory,
} from './workdir.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
const preflightOnly = process.argv[4] === '--preflight-only';
assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
assert.ok([1, 2].includes(attempt));
assert.equal(process.argv.length, preflightOnly ? 5 : 4);
const frozen = await verifyFrozen();
const item = buildPilotCase(index);
assert.equal(sha256(item.input), frozen.cases[index].input_sha256);
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, frozen.cli_version);
const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const sourceDirectory = import.meta.dirname;
const { modelDirectory, rawDirectory } = createRunDirectories();
const staged = stageModelDirectory(modelDirectory, sourceDirectory, item.context);
assert.deepEqual(staged, frozen.cases[index].staged_file_sha256);
const configArgs = permissionConfigArgs(modelDirectory, repositoryRoot);
const rawSentinel = path.join(rawDirectory, 'private-sentinel.txt');
fs.writeFileSync(rawSentinel, 'private', { mode: 0o600 });
const sibling = (index + 1) % CASE_ORDER.length;
const sessionHistory =
  '/Users/navnn/.codex/sessions/2026/02/07/rollout-2026-02-07T06-13-17-019c35df-fd91-7e02-8d37-86533f585868.jsonl.zst';
const deniedFiles = [
  {
    path: path.resolve(sourceDirectory, '../../v34/evidence/fixture.json'),
    expectedSha256: frozen.v34_fixture_sha256,
  },
  {
    path: path.resolve(sourceDirectory, '../../v34/scorer.mjs'),
    expectedSha256: frozen.v34_scorer_sha256,
  },
  {
    path: path.join(sourceDirectory, 'evidence', `context-${sibling}.json`),
    expectedSha256: frozen.cases[sibling].context_sha256,
  },
  {
    path: path.join(sourceDirectory, 'evidence', 'answer-worker.mjs'),
    expectedSha256: frozen.answer_worker_sha256,
  },
  { path: rawSentinel, expectedSha256: sha256('private') },
  {
    path: '/Users/navnn/.codex/config.toml',
    expectedSha256: sha256(fs.readFileSync('/Users/navnn/.codex/config.toml')),
  },
  { path: sessionHistory, expectedSha256: sha256(fs.readFileSync(sessionHistory)) },
];
const boundary = probeReadBoundary({ modelDirectory, repositoryRoot, deniedFiles });
const validator = probePublicValidator(modelDirectory, repositoryRoot);
if (preflightOnly) {
  const broken = await gradeSubmittedWorker(modelDirectory, item.seed);
  process.stdout.write(
    `${JSON.stringify({ index, input_sha256: frozen.cases[index].input_sha256, staged, boundary, validator, broken_exact: broken.exact, broken_evaluation_error: broken.evaluation_error })}\n`,
  );
  fs.rmSync(modelDirectory, { recursive: true, force: true });
  fs.rmSync(rawDirectory, { recursive: true, force: true });
  process.exit(0);
}
const args = [
  'exec',
  '--ephemeral',
  '--ignore-user-config',
  '--skip-git-repo-check',
  '-C',
  modelDirectory,
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
  schema_version: 'f10-v38-astra-remote-repair-launch-v1',
  source_commit: frozen.source_commit,
  case_index: index,
  seed: item.seed,
  attempt,
  input_sha256: frozen.cases[index].input_sha256,
  staged_file_sha256: staged,
  permission_config_sha256: sha256(JSON.stringify(configArgs)),
  model_boundary: boundary,
  public_validator: validator,
  cli_version: version,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
const eventsPath = path.join(rawDirectory, 'events.jsonl');
const stderrPath = path.join(rawDirectory, 'stderr.txt');
const events = fs.createWriteStream(eventsPath, { mode: 0o600 });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600 });
process.stdout.write(`${rawDirectory}\n`);
const child = spawn('codex', args, { cwd: modelDirectory, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
child.stderr.pipe(errors);
child.stdin.end(item.input);
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
await Promise.all([finished(events), finished(errors)]);
const eventBytes = fs.readFileSync(eventsPath);
const eventValidation = validateEventStream(eventBytes.toString('utf8'));
const inspection = inspectModelDirectory(modelDirectory, staged);
let grade = null;
let evaluatorError = null;
if (exitCode === 0 && eventValidation.complete && inspection.sound) {
  try {
    grade = await gradeSubmittedWorker(modelDirectory, item.seed);
    evaluatorError = grade.evaluation_error;
  } catch (error) {
    evaluatorError = String(error);
  }
}
const classified = evaluatorError
  ? { status: 'harness-or-evaluator-error', grade: null }
  : classifyRun(exitCode, eventValidation, inspection, grade);
const finalMessage = eventValidation.final_message ?? '';
fs.writeFileSync(path.join(rawDirectory, 'response.txt'), finalMessage, { mode: 0o600 });
if (inspection.sound) {
  fs.copyFileSync(
    path.join(modelDirectory, 'release-worker.mjs'),
    path.join(rawDirectory, 'submitted-worker.mjs'),
  );
}
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  tool_items: eventValidation.tool_items,
  event_validation: eventValidation,
  inspection,
  evaluator_error: evaluatorError,
  response_sha256: sha256(finalMessage),
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  submitted_worker_sha256: inspection.sound
    ? sha256(fs.readFileSync(path.join(rawDirectory, 'submitted-worker.mjs')))
    : null,
  ...classified,
};
// Private seed and result metadata are written only after the model exits.
fs.writeFileSync(path.join(rawDirectory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
});
fs.writeFileSync(path.join(rawDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
fs.rmSync(modelDirectory, { recursive: true, force: true });
process.stdout.write(
  `${JSON.stringify({ directory: rawDirectory, status: summary.status, exact: summary.grade?.exact ?? null, tool_items: summary.tool_items })}\n`,
);
