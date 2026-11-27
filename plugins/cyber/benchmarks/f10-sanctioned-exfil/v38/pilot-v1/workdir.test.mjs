import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildPilotCase } from './pilot.mjs';
import {
  createRunDirectories,
  inspectModelDirectory,
  permissionConfigArgs,
  snapshotModelDirectory,
  stageModelDirectory,
} from './workdir.mjs';

test('staging contains only public files and detects prohibited edits', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  try {
    const staged = stageModelDirectory(
      modelDirectory,
      import.meta.dirname,
      buildPilotCase(0).context,
    );
    assert.equal(Object.keys(staged).length, 8);
    assert.deepEqual(snapshotModelDirectory(modelDirectory), staged);
    assert.equal(inspectModelDirectory(modelDirectory, staged).sound, true);
    fs.appendFileSync(path.join(modelDirectory, 'README-public.md'), '\nchanged');
    assert.equal(inspectModelDirectory(modelDirectory, staged).sound, false);
    const config = permissionConfigArgs(
      modelDirectory,
      path.resolve(import.meta.dirname, '../../../../../../../..'),
    );
    assert.ok(config.join(' ').includes('network.enabled=false'));
  } finally {
    fs.rmSync(modelDirectory, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
});
