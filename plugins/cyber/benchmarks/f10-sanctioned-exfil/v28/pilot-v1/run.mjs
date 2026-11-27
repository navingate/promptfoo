#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { classifyRun } from './classify.mjs';
import { validateEventStream } from './events.mjs';
import { verifyFrozen } from './freeze.mjs';
import { buildPilotCase, CASE_ORDER } from './pilot.mjs';
import {
  createRunDirectories,
  inspectModelDirectory,
  permissionConfigArgs,
  stageModelDirectory,
} from './workdir.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
assert.ok([1, 2].includes(attempt));
const frozen = verifyFrozen();
const item = buildPilotCase(index);
const entry = frozen.cases[index];
assert.equal(sha256(item.input), entry.input_sha256);
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, frozen.cli_version);
const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const sourceDirectory = path.resolve(import.meta.dirname, '..');
const { modelDirectory, rawDirectory } = createRunDirectories();
const staged = stageModelDirectory(modelDirectory, item, sourceDirectory);
assert.deepEqual(staged, entry.staged_file_sha256);
const configArgs = permissionConfigArgs(modelDirectory, repositoryRoot);
const privateFixture = path.join(sourceDirectory, 'evidence', 'fixture.json');
const privateSiblingCase = path.join(
  import.meta.dirname,
  'evidence',
  `observation-${(index + 1) % CASE_ORDER.length}.json`,
);
const privateRawProbe = path.join(rawDirectory, 'private-sentinel.txt');
fs.writeFileSync(privateRawProbe, 'private');
const probe = `
  const fs = require('node:fs');
  const [publicPath, privatePath, siblingPath, rawPath, editablePath] = process.argv.slice(1);
  const canRead = (p) => { try { fs.readFileSync(p); return true; } catch { return false; } };
  if (!canRead(publicPath) || canRead(privatePath) || canRead(siblingPath) || canRead(rawPath)) process.exit(2);
  fs.writeFileSync(editablePath, fs.readFileSync(editablePath));
`;
execFileSync(
  'codex',
  [
    'sandbox',
    '-P',
    'f10pilot',
    ...configArgs,
    process.execPath,
    '-e',
    probe,
    path.join(modelDirectory, 'observation.json'),
    privateFixture,
    privateSiblingCase,
    privateRawProbe,
    path.join(modelDirectory, 'eligibility-view.json'),
  ],
  { cwd: modelDirectory },
);
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
  schema_version: 'f10-v28-astra-view-repair-launch-v1',
  source_commit: frozen.source_commit,
  case_index: index,
  seed: item.seed,
  attempt,
  input_sha256: entry.input_sha256,
  staged_file_sha256: staged,
  permission_config_sha256: sha256(JSON.stringify(configArgs)),
  read_boundary_probe: 'public read and view write allowed; fixture, sibling case and raw denied',
  cli_version: version,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
const eventsPath = path.join(rawDirectory, 'events.jsonl');
const stderrPath = path.join(rawDirectory, 'stderr.txt');
const events = fs.createWriteStream(eventsPath, { mode: 0o600 });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600 });
process.stdout.write(`${rawDirectory}\n`);
const child = spawn('codex', args, {
  cwd: modelDirectory,
  stdio: ['pipe', 'pipe', 'pipe'],
});
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
const { status, grade } = classifyRun(exitCode, eventValidation, inspection, item.seed);
const finalMessage = eventValidation.final_message ?? '';
fs.writeFileSync(path.join(rawDirectory, 'response.txt'), finalMessage, { mode: 0o600 });
if (inspection.sound) {
  fs.copyFileSync(
    path.join(modelDirectory, 'eligibility-view.json'),
    path.join(rawDirectory, 'submitted-view.json'),
  );
}
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  tool_items: eventValidation.tool_items,
  event_validation: eventValidation,
  inspection: { sound: inspection.sound, reason: inspection.reason, hashes: inspection.hashes },
  response_sha256: sha256(finalMessage),
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  status,
  grade,
};
// Seed, future effects and grading are written only after the model process exits.
fs.writeFileSync(path.join(rawDirectory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
});
fs.writeFileSync(path.join(rawDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
fs.rmSync(modelDirectory, { recursive: true });
process.stdout.write(
  `${JSON.stringify({ directory: rawDirectory, status, exact: grade?.exact ?? null, tool_items: eventValidation.tool_items })}\n`,
);
