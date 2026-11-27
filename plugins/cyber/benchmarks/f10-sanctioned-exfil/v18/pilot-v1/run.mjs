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
assert.ok([0, 1].includes(index), 'usage: node run.mjs <index: 0|1> <attempt: 1|2>');
assert.ok([1, 2].includes(attempt), 'attempt must be 1 or 2');

const frozen = verifyFrozen();
const item = buildPilotCase(index);
const caseEntry = frozen.cases.find((entry) => entry.index === index);
assert.equal(sha256(item.input), caseEntry.input_sha256);
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, frozen.cli_version);
const sessionDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), `f10-v18-astra-${index}-${attempt}-`),
);
fs.chmodSync(sessionDirectory, 0o700);
const responsePath = path.join(sessionDirectory, 'response.txt');
const eventPath = path.join(sessionDirectory, 'events.jsonl');
const stderrPath = path.join(sessionDirectory, 'stderr.txt');
const args = [
  'exec',
  '--model',
  frozen.model,
  '-c',
  `model_reasoning_effort="${frozen.reasoning_effort}"`,
  '--cyber-access-program',
  frozen.requested_cyber_access_program,
  '--sandbox',
  'read-only',
  '--ask-for-approval',
  'never',
  '--ignore-user-config',
  '--skip-git-repo-check',
  '--ephemeral',
  '--no-daemon',
  '--json',
  '-C',
  sessionDirectory,
  '-o',
  responsePath,
  '-',
];
const launch = {
  schema_version: 'f10-v18-astra-pilot-launch-v1',
  candidate_source_commit: frozen.source_commit,
  case_index: index,
  seed: item.seed,
  attempt,
  input_sha256: caseEntry.input_sha256,
  cli_version: version,
  command: ['codex', ...args],
  started_at_utc: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(sessionDirectory, 'launch.json'),
  `${JSON.stringify(launch, null, 2)}\n`,
  {
    mode: 0o600,
  },
);
process.stdout.write(`${sessionDirectory}\n`);

const events = fs.createWriteStream(eventPath, { mode: 0o600 });
const errors = fs.createWriteStream(stderrPath, { mode: 0o600 });
const child = spawn('codex', args, { cwd: sessionDirectory, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
child.stderr.pipe(errors);
child.stdin.end(item.input);
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
await Promise.all([finished(events), finished(errors)]);
const response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath, 'utf8') : '';
const eventBytes = fs.readFileSync(eventPath);
const toolItems = eventBytes
  .toString('utf8')
  .split('\n')
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)
        ? [event.item]
        : [];
    } catch {
      return [];
    }
  });
const grade =
  exitCode === 0 && toolItems.length === 0 ? gradeResponse(response, item.answers) : null;
const summary = {
  ...launch,
  completed_at_utc: new Date().toISOString(),
  exit_code: exitCode,
  tool_items: toolItems.length,
  response_sha256: sha256(response),
  events_sha256: sha256(eventBytes),
  stderr_sha256: sha256(fs.readFileSync(stderrPath)),
  status:
    exitCode === 0
      ? toolItems.length
        ? 'invalid-tool-use'
        : grade.valid
          ? 'valid'
          : 'invalid-output'
      : 'provider-or-cli-error',
  grade,
};
fs.writeFileSync(
  path.join(sessionDirectory, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  {
    mode: 0o600,
  },
);
process.stdout.write(`${JSON.stringify({ directory: sessionDirectory, ...summary })}\n`);
