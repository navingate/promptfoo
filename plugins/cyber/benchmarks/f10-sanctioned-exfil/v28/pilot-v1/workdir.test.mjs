import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildPilotCase } from './pilot.mjs';
import {
  createRunDirectories,
  inspectModelDirectory,
  permissionConfigArgs,
  stageModelDirectory,
} from './workdir.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../../../../../..');
const sourceDirectory = path.resolve(import.meta.dirname, '..');

test('staged view is editable while public evidence and private truth are OS-separated', () => {
  const { modelDirectory, rawDirectory } = createRunDirectories();
  const item = buildPilotCase(0);
  const staged = stageModelDirectory(modelDirectory, item, sourceDirectory);
  fs.writeFileSync(path.join(rawDirectory, 'private-sentinel.txt'), 'secret');
  const configArgs = permissionConfigArgs(modelDirectory, repositoryRoot);
  const probe = `
    const fs = require('node:fs');
    const [publicPath, privatePath, rawPath, siblingPath, editablePath] = process.argv.slice(1);
    const canRead = (p) => { try { fs.readFileSync(p); return true; } catch { return false; } };
    if (!canRead(publicPath) || canRead(privatePath) || canRead(rawPath) || canRead(siblingPath)) process.exit(2);
    fs.writeFileSync(editablePath, fs.readFileSync(editablePath));
  `;
  const paths = [
    path.join(modelDirectory, 'observation.json'),
    path.join(sourceDirectory, 'evidence', 'fixture.json'),
    path.join(rawDirectory, 'private-sentinel.txt'),
    path.join(sourceDirectory, 'evidence', 'screen-results.json'),
    path.join(modelDirectory, 'eligibility-view.json'),
  ];
  execFileSync(
    'codex',
    ['sandbox', '-P', 'f10pilot', ...configArgs, process.execPath, '-e', probe, ...paths],
    {
      cwd: modelDirectory,
    },
  );
  const validation = JSON.parse(
    execFileSync(
      'codex',
      [
        'sandbox',
        '-P',
        'f10pilot',
        ...configArgs,
        process.execPath,
        'view-tool.mjs',
        'validate',
        'observation.json',
        'eligibility-view.json',
      ],
      { cwd: modelDirectory, encoding: 'utf8' },
    ),
  );
  assert.equal(validation.valid, true);
  assert.equal(inspectModelDirectory(modelDirectory, staged).sound, true);
  fs.rmSync(modelDirectory, { recursive: true });
  fs.rmSync(rawDirectory, { recursive: true });
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
