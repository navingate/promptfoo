import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { assertModelDirectoryClean, createRunDirectories } from './workdir.mjs';

test('model working directory is empty and separate from raw metadata', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  try {
    assert.notEqual(modelDirectory, rawDirectory);
    assert.equal(assertModelDirectoryClean(modelDirectory), true);
    fs.writeFileSync(path.join(modelDirectory, 'private.json'), '{}');
    assert.throws(() => assertModelDirectoryClean(modelDirectory));
  } finally {
    fs.rmSync(modelDirectory, { recursive: true });
    fs.rmSync(rawDirectory, { recursive: true });
  }
});
