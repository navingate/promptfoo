import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildPilotCase } from './pilot.mjs';
import {
  createRunDirectories,
  inspectModelDirectory,
  probeReadBoundary,
  stageModelDirectory,
} from './workdir.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const sourceDirectory = path.resolve(import.meta.dirname, '..');

test('staged view is editable while public evidence and private truth are OS-separated', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  const siblingDirectory = fs.mkdtempSync('/private/tmp/f10-v28-sibling-');
  const item = buildPilotCase(0);
  const staged = stageModelDirectory(modelDirectory, item, sourceDirectory);
  const rawPath = path.join(rawDirectory, 'private-sentinel.txt');
  const siblingPath = path.join(siblingDirectory, 'sibling.json');
  fs.writeFileSync(rawPath, 'secret');
  fs.writeFileSync(siblingPath, '{"sibling":true}');
  const privatePaths = [
    path.join(sourceDirectory, 'evidence', 'fixture.json'),
    rawPath,
    siblingPath,
    '/Users/navnn/.codex/config.toml',
  ];
  const result = probeReadBoundary({
    modelDirectory,
    repositoryRoot,
    deniedFiles: privatePaths.map((file) => ({
      path: file,
      expectedSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    })),
  });
  assert.equal(result.validator.valid, true);
  assert.equal(inspectModelDirectory(modelDirectory, staged).sound, true);
  fs.rmSync(modelDirectory, { recursive: true });
  fs.rmSync(rawDirectory, { recursive: true });
  fs.rmSync(siblingDirectory, { recursive: true });
});

test('post-run audit rejects changed public tool and extra files', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  const staged = stageModelDirectory(modelDirectory, buildPilotCase(0), sourceDirectory);
  fs.appendFileSync(path.join(modelDirectory, 'view.mjs'), '\n// changed\n');
  assert.equal(inspectModelDirectory(modelDirectory, staged).sound, false);
  fs.writeFileSync(path.join(modelDirectory, 'extra.json'), '{}');
  assert.equal(inspectModelDirectory(modelDirectory, staged).sound, false);
  fs.rmSync(modelDirectory, { recursive: true });
  fs.rmSync(rawDirectory, { recursive: true });
});
