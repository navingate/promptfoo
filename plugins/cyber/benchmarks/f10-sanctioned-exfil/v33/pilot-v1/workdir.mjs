import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createRunDirectories() {
  const modelDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v33-model-'));
  const rawDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v33-raw-'));
  fs.chmodSync(modelDirectory, 0o700);
  fs.chmodSync(rawDirectory, 0o700);
  assert.notEqual(modelDirectory, rawDirectory);
  return { modelDirectory, rawDirectory };
}

export function assertModelDirectoryClean(modelDirectory) {
  assert.deepEqual(fs.readdirSync(modelDirectory), [], 'model-directory-not-empty');
  return true;
}
