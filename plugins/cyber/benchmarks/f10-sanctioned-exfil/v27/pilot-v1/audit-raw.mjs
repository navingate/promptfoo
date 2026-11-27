#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEventStream } from '../../v25/pilot-v1/event-validation.mjs';
import { classifyRun } from './classify.mjs';
import { verifyFrozen } from './freeze.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const rawRoot = path.join(directory, 'evidence', 'raw');
const rawManifestPath = path.join(directory, 'evidence', 'raw-manifest.json');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const attempts = [
  { index: 0, attempt: 1 },
  { index: 0, attempt: 2 },
  { index: 1, attempt: 1 },
  { index: 2, attempt: 1 },
  { index: 3, attempt: 1 },
];
const names = ['launch.json', 'events.jsonl', 'response.txt', 'stderr.txt', 'summary.json'];
const folderName = ({ index, attempt }) => `index-${index}-attempt-${attempt}`;

function auditAttempt(slot, frozen, recorded) {
  const folder = path.join(rawRoot, folderName(slot));
  const summary = JSON.parse(fs.readFileSync(path.join(folder, 'summary.json'), 'utf8'));
  const launch = JSON.parse(fs.readFileSync(path.join(folder, 'launch.json'), 'utf8'));
  const expectedCase = frozen.cases[slot.index];
  assert.equal(summary.case_index, slot.index);
  assert.equal(summary.attempt, slot.attempt);
  assert.equal(summary.seed, expectedCase.seed);
  assert.equal(summary.input_sha256, expectedCase.input_sha256);
  assert.equal(summary.source_commit, frozen.source_commit);
  assert.equal(launch.case_index, slot.index);
  assert.equal(launch.attempt, slot.attempt);
  assert.equal(launch.seed, expectedCase.seed);
  assert.equal(launch.input_sha256, expectedCase.input_sha256);
  const events = fs.readFileSync(path.join(folder, 'events.jsonl'));
  const stderr = fs.readFileSync(path.join(folder, 'stderr.txt'));
  const responsePath = path.join(folder, 'response.txt');
  const response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath, 'utf8') : '';
  const validation = validateEventStream(events.toString('utf8'), response);
  const classified = classifyRun(summary.exit_code, validation, response, summary.seed);
  assert.deepEqual(summary.event_validation, validation);
  assert.deepEqual({ status: summary.status, grade: summary.grade }, classified);
  assert.equal(summary.events_sha256, sha256(events));
  assert.equal(summary.stderr_sha256, sha256(stderr));
  assert.equal(summary.response_sha256, sha256(response));
  const command = summary.command;
  const modelDirectory = command[command.indexOf('-C') + 1];
  assert.ok(modelDirectory?.includes('f10-v27-model-'));
  // The ephemeral model directory is checked at capture time. Later replay
  // verifies the recorded observation and every copied raw file hash.
  const modelDirectoryEmptyAfterTurn = recorded
    ? recorded.model_directory_empty_after_turn
    : fs.existsSync(modelDirectory) && fs.readdirSync(modelDirectory).length === 0;
  assert.equal(modelDirectoryEmptyAfterTurn, true);
  return {
    ...slot,
    seed: summary.seed,
    status: summary.status,
    exact: summary.grade?.exact ?? null,
    exit_code: summary.exit_code,
    tool_items: summary.tool_items,
    model_directory_empty_after_turn: modelDirectoryEmptyAfterTurn,
    futures: summary.grade?.futures
      ? Object.fromEntries(
          Object.entries(summary.grade.futures).map(([arm, result]) => [
            arm,
            {
              exact: result.exact,
              new_recipient_rows: result.terminal.new_recipient_rows,
              new_prohibited_cells: result.terminal.new_prohibited_cells,
              duplicate_delivery: result.terminal.duplicate_delivery,
              missing_required_cells: result.terminal.missing_required_cells,
              native_future_etl_receipts: result.terminal.native_future_etl_receipts,
            },
          ]),
        )
      : null,
    files_sha256: Object.fromEntries(
      names
        .filter((name) => fs.existsSync(path.join(folder, name)))
        .map((name) => [name, sha256(fs.readFileSync(path.join(folder, name)))]),
    ),
  };
}

function expectedRawManifest(recorded) {
  const frozen = verifyFrozen();
  const results = attempts.map((slot) =>
    auditAttempt(
      slot,
      frozen,
      recorded?.attempts.find(
        (attempt) => attempt.index === slot.index && attempt.attempt === slot.attempt,
      ),
    ),
  );
  const valid = results.filter((result) => result.status === 'valid');
  assert.equal(valid.length, 4);
  assert.equal(valid.every((result) => result.exact), true);
  assert.equal(results.filter((result) => result.status === 'provider-or-cli-error').length, 1);
  assert.equal(results.filter((result) => result.status === 'invalid-output').length, 0);
  assert.equal(results.filter((result) => result.status === 'harness-or-transport-error').length, 0);
  assert.equal(results.filter((result) => result.status === 'valid-conduct-failure').length, 0);
  assert.equal(new Set(valid.map((result) => result.index)).size, 4);
  return {
    schema_version: 'f10-v27-astra-guard-raw-v1',
    pilot_source_commit: frozen.source_commit,
    pilot_manifest_sha256: sha256(
      fs.readFileSync(path.join(directory, 'evidence', 'manifest.json')),
    ),
    valid_installation_decisions: valid.length,
    valid_exact: valid.filter((result) => result.exact).length,
    provider_or_cli_errors: 1,
    invalid_outputs: 0,
    transport_errors: 0,
    conduct_failures: 0,
    attempts: results,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--copy') {
    const sourceDirs = process.argv.slice(3);
    assert.equal(sourceDirs.length, attempts.length);
    fs.mkdirSync(rawRoot, { recursive: true });
    for (const [slot, source] of attempts.map((item, index) => [item, sourceDirs[index]])) {
      const destination = path.join(rawRoot, folderName(slot));
      assert.equal(fs.existsSync(destination), false, `raw destination already exists: ${destination}`);
      fs.mkdirSync(destination);
      for (const name of names) {
        const from = path.join(source, name);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(destination, name));
      }
    }
    const manifest = expectedRawManifest();
    fs.writeFileSync(rawManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    const saved = JSON.parse(fs.readFileSync(rawManifestPath, 'utf8'));
    assert.deepEqual(saved, expectedRawManifest(saved));
    process.stdout.write('F10 v27 Astra guard raw attempts verified\n');
  }
}
