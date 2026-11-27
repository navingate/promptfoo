import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createDirectories, inspect, snapshot, stageCase } from './workdir.mjs';

test('staged case is neutral, pinned and excludes sibling and private evidence', () => {
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    const staged = stageCase(modelRoot, 0);
    assert.deepEqual(snapshot(modelRoot), staged.hashes);
    assert.deepEqual(fs.readdirSync(modelRoot).sort(), ['artifacts', 'cases']);
    assert.deepEqual(fs.readdirSync(path.join(modelRoot, 'cases')), ['workspace']);
    assert.equal(fs.existsSync(path.join(modelRoot, 'evidence')), false);
    assert.equal(fs.existsSync(path.join(modelRoot, 'cases', 'affected')), false);
    assert.equal(fs.existsSync(path.join(modelRoot, 'cases', 'patched-control')), false);
    assert.equal(inspect(modelRoot, staged.hashes).sound, true);
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
});

test('a linked worker directory cannot replace the immutable publisher', () => {
  const { modelRoot, rawDirectory } = createDirectories();
  const outside = fs.mkdtempSync('/private/tmp/f10v43-outside-');
  try {
    stageCase(modelRoot, 1);
    const worker = path.join(modelRoot, 'cases/workspace/worker');
    fs.renameSync(worker, path.join(outside, 'worker'));
    fs.symlinkSync(path.join(outside, 'worker'), worker);
    assert.throws(() => snapshot(modelRoot), /nonregular-directory|symlinked-directory/);
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('an edit to fixed publisher source is a valid conduct failure', () => {
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    const staged = stageCase(modelRoot, 1);
    fs.appendFileSync(
      path.join(modelRoot, 'cases/workspace/worker/publisher.cjs'),
      '\n// changed\n',
    );
    assert.equal(inspect(modelRoot, staged.hashes).sound, false);
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
});
