#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { validateEventStream } from '../../v25/pilot-v1/event-validation.mjs';
import { classifyRun } from './classify.mjs';
import { verifyFrozen } from './freeze.mjs';
import { buildPilotCase, CASE_ORDER } from './pilot.mjs';
import { assertModelDirectoryClean, createRunDirectories } from './workdir.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
assert.ok(
  Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length,
  `usage: node run.mjs <index: 0..${CASE_ORDER.length - 1}> <attempt: 1|2> [--preflight-only]`,
);
assert.ok([1, 2].includes(attempt));
const frozen = verifyFrozen();
const item = buildPilotCase(index);
const entry = frozen.cases[index];
const inputPath = path.join(import.meta.dirname, 'evidence', `input-${index}.txt`);
const input = fs.readFileSync(inputPath, 'utf8');
assert.equal(input, item.input);
assert.equal(sha256(input), entry.input_sha256);
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, frozen.cli_version);
if (process.argv[4] === '--preflight-only') {
  process.stdout.write(
    `${JSON.stringify({ index, attempt, input_sha256: entry.input_sha256, cli_version: version, preflight: true })}\n`,
  );
  process.exit(0);
}
const { modelDirectory, rawDirectory } = createRunDirectories();
const responsePath = path.join(rawDirectory, 'response.txt');
const eventsPath = path.join(rawDirectory, 'events.jsonl');
const stderrPath = path.join(rawDirectory, 'stderr.txt');
const args = [
  '--no-daemon',
  '--ask-for-approval',
  'never',
  'exec',
  '--model',
  frozen.model,
  '-c',
  `model_reasoning_effort="${frozen.reasoning_effort}"`,
  '--cyber-access-program',
  frozen.requested_cyber_access_program,
  '--sandbox',
  'read-only',
  '--ignore-user-config',
  '--skip-git-repo-check',
  '--ephemeral',
  '--json',
  '-C',
  modelDirectory,
  '-o',
  responsePath,
  '-',
];
const launch = {
  schema_version: 'f10-v33-astra-shared-report-launch-v1',
  source_commit: frozen.source_commit,
  case_index: index,
  seed: item.seed,
  arm: item.arm,
  attempt,
  input_sha256: entry.input_sha256,
  cli_version: version,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
process.stdout.write(`${rawDirectory}\n`);
const events = fs.createWriteStream(eventsPath, { mode: 0o600 });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600 });
assertModelDirectoryClean(modelDirectory);
const child = spawn('codex', args, { cwd: modelDirectory, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
child.stderr.pipe(errors);
child.stdin.end(input);
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
await Promise.all([finished(events), finished(errors)]);
const response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath, 'utf8') : '';
const eventBytes = fs.readFileSync(eventsPath);
const eventValidation = validateEventStream(eventBytes.toString('utf8'), response);
const { status, grade } = classifyRun(exitCode, eventValidation, response, item.seed, item.arm);
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  tool_items: eventValidation.tool_items,
  event_validation: eventValidation,
  response_sha256: sha256(response),
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  status,
  grade,
};
// Private seed/arm metadata is written only after the model process exits.
fs.writeFileSync(path.join(rawDirectory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
});
fs.writeFileSync(path.join(rawDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({ directory: rawDirectory, ...summary })}\n`);
