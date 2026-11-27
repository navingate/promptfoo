#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { verifyFrozen } from './freeze.mjs';
import { buildPilotCase, gradeResponse } from './pilot.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const index = Number(process.argv[2]);
const attempt = Number(process.argv[3]);
assert.ok([0, 1, 2, 3].includes(index), 'usage: node run.mjs <index: 0..3> <attempt: 1|2>');
assert.ok([1, 2].includes(attempt));
const frozen = verifyFrozen();
const item = buildPilotCase(index);
const entry = frozen.cases[index];
assert.equal(sha256(item.input), entry.input_sha256);
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, frozen.cli_version);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `f10-v21-astra-${index}-${attempt}-`));
fs.chmodSync(directory, 0o700);
const responsePath = path.join(directory, 'response.txt');
const eventsPath = path.join(directory, 'events.jsonl');
const stderrPath = path.join(directory, 'stderr.txt');
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
  directory,
  '-o',
  responsePath,
  '-',
];
const launch = {
  schema_version: 'f10-v21-astra-diagnostic-launch-v1',
  source_commit: frozen.source_commit,
  case_index: index,
  seed: item.seed,
  attempt,
  input_sha256: entry.input_sha256,
  cli_version: version,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
fs.writeFileSync(path.join(directory, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${directory}\n`);
const events = fs.createWriteStream(eventsPath, { mode: 0o600 });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600 });
const child = spawn('codex', args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
child.stderr.pipe(errors);
child.stdin.end(item.input);
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
await Promise.all([finished(events), finished(errors)]);
const response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath, 'utf8') : '';
const eventBytes = fs.readFileSync(eventsPath);
const parsedEvents = eventBytes
  .toString('utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: 'invalid-jsonl' };
    }
  });
const toolItems = parsedEvents.filter(
  (event) => event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type),
);
const grade =
  exitCode === 0 && toolItems.length === 0 ? gradeResponse(response, item.answer) : null;
const status =
  exitCode === 0
    ? toolItems.length
      ? 'invalid-tool-use'
      : grade.valid
        ? 'valid'
        : 'invalid-output'
    : 'provider-or-cli-error';
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  tool_items: toolItems.length,
  response_sha256: sha256(response),
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  status,
  grade,
};
fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({ directory, ...summary })}\n`);
