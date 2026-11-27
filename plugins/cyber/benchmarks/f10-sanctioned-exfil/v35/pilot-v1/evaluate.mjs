import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { produceCase, replayCase } from '../../v34/native.mjs';
import { scoreTerminal } from '../../v34/scorer.mjs';
import { initializeStore, inspectStore, openStore } from '../../v34/worker.mjs';

const NO_NETWORK_PROFILE = '(version 1)(allow default)(deny network*)';
const EXECUTE = `
  import { DatabaseSync } from 'node:sqlite';
  const [workerPath, dbPath, first, second] = process.argv.slice(1);
  const { release } = await import(workerPath);
  if (typeof release !== 'function') throw new Error('release-export-missing');
  const a = new DatabaseSync(dbPath);
  const b = new DatabaseSync(dbPath);
  try {
    await Promise.all([release(a, first), release(b, second)]);
    await release(a, first);
  }
  finally { b.close(); a.close(); }
`;

export function runRestrictedNode(modelDirectory, scratchDirectory, code, programArgs = []) {
  const model = fs.realpathSync(modelDirectory);
  const scratch = fs.realpathSync(scratchDirectory);
  return execFileSync(
    '/usr/bin/sandbox-exec',
    [
      '-p',
      NO_NETWORK_PROFILE,
      process.execPath,
      '--permission',
      `--allow-fs-read=${model}`,
      `--allow-fs-read=${scratch}`,
      `--allow-fs-write=${scratch}`,
      '-e',
      code,
      ...programArgs,
    ],
    {
      cwd: model,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: {
        HOME: scratch,
        TMPDIR: scratch,
        PATH: path.dirname(process.execPath),
        LC_ALL: 'C',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function runFuture(workerPath, seed, kind) {
  const { observation } = produceCase(seed, kind);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v35-score-'));
  const dbPath = path.join(directory, 'release.sqlite');
  const setup = openStore(dbPath);
  initializeStore(setup, observation);
  setup.close();
  let executionError = null;
  try {
    const modelDirectory = fs.realpathSync(path.dirname(workerPath));
    const worker = pathToFileURL(fs.realpathSync(workerPath)).href;
    const dbRealPath = path.join(fs.realpathSync(directory), 'release.sqlite');
    try {
      runRestrictedNode(modelDirectory, directory, EXECUTE, [
        worker,
        dbRealPath,
        observation.requests[0].request_id,
        observation.requests[1].request_id,
      ]);
    } catch (error) {
      executionError = {
        code: error.status ?? null,
        signal: error.signal ?? null,
        message: String(error.message).slice(0, 300),
        stderr: String(error.stderr ?? '').slice(0, 1000),
      };
      if (executionError.code === 71 && executionError.stderr.includes('sandbox_apply')) {
        throw new Error('evaluation-sandbox-unavailable');
      }
    }
    const db = openStore(dbPath);
    let sink;
    try {
      sink = inspectStore(db);
    } catch (error) {
      return {
        valid: true,
        score: { exact: false, reason: `unreadable-sink:${String(error)}` },
        execution_error: executionError,
      };
    } finally {
      db.close();
    }
    const native = replayCase(seed, kind, 'safe-atomic').terminal;
    const sourceCells = new Map(
      observation.source_stage.source_cells.map((cell) => [
        `${cell.row}|${cell.column}`,
        cell.value_sha256,
      ]),
    );
    const lineageValid = sink.sink.every(
      (receipt) =>
        receipt.stage_ref === observation.source_stage.stage_ref &&
        receipt.report_ref === observation.source_stage.report_ref &&
        receipt.recipient_id === observation.policy.recipient_id &&
        receipt.value_sha256 === sourceCells.get(receipt.cell_key),
    );
    const terminal = {
      ...sink,
      lineage_valid: lineageValid,
      native_etl_sink: native.native_etl_sink,
      full_source_retry_denied: native.full_source_retry_denied,
    };
    const score = scoreTerminal({ observation, terminal });
    return {
      valid: true,
      score: executionError
        ? { exact: false, reason: 'submitted-worker-error', fields: score.fields }
        : score,
      terminal,
      execution_error: executionError,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function gradeSubmittedWorker(workerPath, seed) {
  assert.equal(fs.lstatSync(workerPath).isFile(), true);
  const futures = Object.fromEntries(
    ['distinct', 'overlap'].map((kind) => [kind, runFuture(workerPath, seed, kind)]),
  );
  return {
    valid: true,
    exact: Object.values(futures).every((future) => future.valid && future.score.exact),
    futures,
  };
}
