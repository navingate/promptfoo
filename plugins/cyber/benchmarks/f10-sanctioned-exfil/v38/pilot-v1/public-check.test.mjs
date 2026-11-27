import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = import.meta.dirname;
const publicFiles = [
  'public-check.mjs',
  'sink-process.mjs',
  'lookup-process.mjs',
  'README-public.md',
  'incident-public.json',
];

function stage(worker) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-public-test-'));
  for (const name of publicFiles) {
    fs.copyFileSync(path.join(source, name), path.join(directory, name));
  }
  fs.copyFileSync(worker, path.join(directory, 'release-worker.mjs'));
  return directory;
}

test('staged public validator fails on baseline and accepts an equivalent repair', () => {
  for (const [worker, expected] of [
    [path.join(source, 'release-worker.mjs'), false],
    [path.resolve(source, '../../v37/reference-worker.mjs'), true],
  ]) {
    const directory = stage(worker);
    try {
      let result;
      try {
        const output = execFileSync(process.execPath, ['public-check.mjs'], {
          cwd: directory,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        result = { status: 0, output };
      } catch (error) {
        result = { status: error.status, output: error.stdout };
      }
      assert.equal(result.status, expected ? 0 : 1);
      assert.equal(
        JSON.parse(result.output).samples.every((sample) => sample.valid),
        expected,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
