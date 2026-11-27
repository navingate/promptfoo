import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'f10-v41-host-launch-ledger-v1';
const RETRYABLE = new Set([
  'provider-or-cli-error',
  'harness-or-transport-error',
  'harness-or-evaluator-error',
]);
const VALID = new Set(['valid', 'valid-conduct-failure']);

export function emptyLedger(manifestSha256) {
  return {
    schema_version: SCHEMA,
    manifest_sha256: manifestSha256,
    attempts: [],
    stop_reason: null,
  };
}

export function beginAttempt(state, request) {
  assert.equal(state.schema_version, SCHEMA);
  assert.equal(state.manifest_sha256, request.manifest_sha256, 'manifest-changed');
  assert.equal(state.stop_reason, null, 'pilot-stopped');
  assert.ok([0, 1].includes(request.index));
  assert.ok([1, 2].includes(request.attempt));
  assert.ok(
    state.attempts.every((entry) => entry.status !== 'launched'),
    'pending-attempt',
  );
  const sameIndex = state.attempts.filter((entry) => entry.index === request.index);
  if (request.index === 1) {
    const prior = state.attempts.filter((entry) => entry.index === 0).at(-1);
    assert.ok(prior && VALID.has(prior.status), 'case-zero-not-valid');
  }
  if (request.attempt === 1) {
    assert.equal(sameIndex.length, 0, 'duplicate-case-attempt');
  } else {
    assert.equal(sameIndex.length, 1, 'second-attempt-count');
    const first = sameIndex[0];
    assert.equal(first.attempt, 1);
    assert.ok(RETRYABLE.has(first.status), 'first-attempt-not-retryable');
    assert.equal(first.input_sha256, request.input_sha256, 'retry-input-changed');
    assert.equal(first.staged_sha256, request.staged_sha256, 'retry-staged-files-changed');
  }
  return {
    ...state,
    attempts: [
      ...state.attempts,
      {
        index: request.index,
        attempt: request.attempt,
        input_sha256: request.input_sha256,
        staged_sha256: request.staged_sha256,
        status: 'launched',
        started_at_utc: request.started_at_utc,
      },
    ],
  };
}

export function finishAttempt(state, result) {
  assert.ok(VALID.has(result.status) || RETRYABLE.has(result.status), 'unknown-attempt-status');
  const attempts = state.attempts.slice();
  const last = attempts.at(-1);
  assert.equal(last?.status, 'launched');
  attempts[attempts.length - 1] = {
    ...last,
    status: result.status,
    exact: result.exact ?? null,
    raw_directory: result.raw_directory,
    summary_sha256: result.summary_sha256,
    completed_at_utc: result.completed_at_utc,
  };
  return {
    ...state,
    attempts,
    stop_reason:
      result.material_harness_defect === true ? 'material-harness-defect' : state.stop_reason,
  };
}

export function stopPilot(state, reason) {
  assert.ok(typeof reason === 'string' && reason.trim().length > 0);
  return { ...state, stop_reason: reason.trim() };
}

function assertEvidenceDirectory(directory) {
  assert.ok(fs.lstatSync(directory).isDirectory(), 'evidence-directory-not-direct');
  assert.equal(fs.realpathSync(directory), directory, 'evidence-directory-symlink');
}

function readLedger(directory, manifestSha256) {
  const file = path.join(directory, 'launch-ledger.json');
  if (!fs.existsSync(file)) {
    return emptyLedger(manifestSha256);
  }
  assert.ok(fs.lstatSync(file).isFile(), 'launch-ledger-not-regular');
  assert.equal(fs.realpathSync(file), file, 'launch-ledger-symlink');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.manifest_sha256, manifestSha256, 'launch-ledger-manifest-mismatch');
  return state;
}

function writeLedger(directory, state) {
  const file = path.join(directory, 'launch-ledger.json');
  const temporary = path.join(directory, `.launch-ledger-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

export function acquireLaunch(directory, request) {
  assertEvidenceDirectory(directory);
  const lock = path.join(directory, 'launch-ledger.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    const state = beginAttempt(readLedger(directory, request.manifest_sha256), request);
    writeLedger(directory, state);
    let closed = false;
    return {
      finish(result) {
        assert.equal(closed, false);
        const current = readLedger(directory, request.manifest_sha256);
        const next = finishAttempt(current, result);
        writeLedger(directory, next);
        fs.closeSync(descriptor);
        fs.rmSync(lock);
        closed = true;
        return next;
      },
    };
  } catch (error) {
    fs.closeSync(descriptor);
    fs.rmSync(lock);
    throw error;
  }
}

export function recordStop(directory, manifestSha256, reason) {
  assertEvidenceDirectory(directory);
  const lock = path.join(directory, 'launch-ledger.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    const state = readLedger(directory, manifestSha256);
    assert.ok(state.attempts.every((entry) => entry.status !== 'launched'));
    writeLedger(directory, stopPilot(state, reason));
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--stop') {
  const reason = process.argv.slice(3).join(' ');
  const directory = path.join(import.meta.dirname, 'evidence');
  const manifest = fs.readFileSync(path.join(directory, 'manifest.json'));
  const sha = crypto.createHash('sha256').update(manifest).digest('hex');
  recordStop(directory, sha, reason);
  process.stdout.write('F10 v41 pilot stopped in host launch ledger\n');
}
