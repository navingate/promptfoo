import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { assertModelDirectoryClean, createRunDirectories } from './workdir.mjs';

test('model cwd is empty and separate from host raw files before spawn', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  try {
    assert.notEqual(modelDirectory, rawDirectory);
    assert.equal(assertModelDirectoryClean(modelDirectory), true);
    fs.writeFileSync(path.join(rawDirectory, 'launch.json'), '{"private_arm":"early"}\n');
    assert.equal(assertModelDirectoryClean(modelDirectory), true);
    fs.writeFileSync(path.join(modelDirectory, 'private-answer.json'), '{}\n');
    assert.throws(() => assertModelDirectoryClean(modelDirectory), /model-directory-not-empty/);
  } finally {
    if (modelDirectory) {
      fs.rmSync(modelDirectory, { recursive: true, force: true });
    }
    if (rawDirectory) {
      fs.rmSync(rawDirectory, { recursive: true, force: true });
    }
  }
});
