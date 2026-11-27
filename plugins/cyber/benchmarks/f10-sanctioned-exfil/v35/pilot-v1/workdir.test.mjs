import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { createRunDirectories, inspectModelDirectory, stageModelDirectory } from './workdir.mjs';

test('only the staged release worker is editable for scoring', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  try {
    const staged = stageModelDirectory(modelDirectory, import.meta.dirname, { sample: true });
    assert.equal(inspectModelDirectory(modelDirectory, staged).sound, true);
    fs.appendFileSync(`${modelDirectory}/release-worker.mjs`, '\n// candidate repair\n');
    assert.equal(inspectModelDirectory(modelDirectory, staged).sound, true);
    fs.appendFileSync(`${modelDirectory}/public-check.mjs`, '\n// altered validator\n');
    assert.equal(inspectModelDirectory(modelDirectory, staged).sound, false);
  } finally {
    fs.rmSync(modelDirectory, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
});
