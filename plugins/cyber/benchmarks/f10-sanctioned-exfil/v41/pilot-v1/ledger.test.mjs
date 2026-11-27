import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { acquireLaunch, beginAttempt, emptyLedger, finishAttempt, stopPilot } from './ledger.mjs';

const request = (index, attempt, extra = {}) => ({
  manifest_sha256: 'manifest',
  input_sha256: 'input',
  staged_sha256: index === 0 ? 'stage0' : 'stage1',
  index,
  attempt,
  started_at_utc: 'frozen-time',
  ...extra,
});
const result = (status) => ({
  status,
  exact: status === 'valid',
  raw_directory: '/private/tmp/record',
  summary_sha256: 'summary',
  completed_at_utc: 'later',
});

test('case order and valid first attempt are enforced', () => {
  const empty = emptyLedger('manifest');
  assert.throws(() => beginAttempt(empty, request(1, 1)), /case-zero-not-valid/);
  assert.throws(() => beginAttempt(empty, request(0, 2)), /second-attempt-count/);
  const launched = beginAttempt(empty, request(0, 1));
  assert.throws(() => beginAttempt(launched, request(0, 1)), /pending-attempt/);
  const valid = finishAttempt(launched, result('valid'));
  assert.throws(() => beginAttempt(valid, request(0, 2)), /first-attempt-not-retryable/);
  assert.equal(beginAttempt(valid, request(1, 1)).attempts.length, 2);
});

test('retry requires a recorded error and identical frozen input', () => {
  const failed = finishAttempt(
    beginAttempt(emptyLedger('manifest'), request(0, 1)),
    result('provider-or-cli-error'),
  );
  assert.throws(() => beginAttempt(failed, request(1, 1)), /case-zero-not-valid/);
  assert.throws(
    () => beginAttempt(failed, request(0, 2, { input_sha256: 'changed' })),
    /retry-input-changed/,
  );
  assert.throws(
    () => beginAttempt(failed, request(0, 2, { staged_sha256: 'changed' })),
    /retry-staged-files-changed/,
  );
  assert.throws(
    () => beginAttempt(failed, request(0, 2, { manifest_sha256: 'changed' })),
    /manifest-changed/,
  );
  assert.equal(beginAttempt(failed, request(0, 2)).attempts.length, 2);
});

test('material harness stop blocks all further launches', () => {
  const failed = finishAttempt(beginAttempt(emptyLedger('manifest'), request(0, 1)), {
    ...result('harness-or-evaluator-error'),
    material_harness_defect: true,
  });
  assert.throws(() => beginAttempt(failed, request(0, 2)), /pilot-stopped/);
  const stopped = stopPilot(emptyLedger('manifest'), 'independent construct defect');
  assert.throws(() => beginAttempt(stopped, request(0, 1)), /pilot-stopped/);
});

test('atomic host ledger leaves no duplicate launch slot', () => {
  const directory = fs.mkdtempSync('/private/tmp/f10v41-ledger-test-');
  try {
    const first = acquireLaunch(directory, request(0, 1));
    assert.throws(() => acquireLaunch(directory, request(0, 1)), /EEXIST/);
    first.finish(result('valid'));
    assert.throws(() => acquireLaunch(directory, request(0, 1)), /duplicate-case-attempt/);
    const second = acquireLaunch(directory, request(1, 1));
    second.finish(result('valid'));
    assert.equal(JSON.parse(fs.readFileSync(`${directory}/launch-ledger.json`)).attempts.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
