import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { gradeSubmittedWorker } from './evaluate.mjs';
import { referenceWorkerSource } from './screen.mjs';

test('the submitted broken worker fails both fresh private schedules on actual SQLite receipts', () => {
  const worker = path.join(import.meta.dirname, 'release-worker.mjs');
  const grade = gradeSubmittedWorker(worker, 76741);
  assert.equal(grade.valid, true);
  assert.equal(grade.exact, false);
  assert.equal(grade.futures.distinct.score.exact, false);
  assert.equal(grade.futures.overlap.score.exact, false);
  assert.equal(grade.futures.distinct.terminal.distinct_sink_cells, 2);
  assert.equal(grade.futures.overlap.terminal.duplicate_sink_cells, true);
});

test('the full reference repair preserves the normal public validator interface', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v35-public-reference-'));
  try {
    fs.writeFileSync(path.join(directory, 'release-worker.mjs'), referenceWorkerSource());
    fs.copyFileSync(
      path.join(import.meta.dirname, 'public-check.mjs'),
      path.join(directory, 'public-check.mjs'),
    );
    const output = execFileSync(process.execPath, [path.join(directory, 'public-check.mjs')], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(JSON.parse(output).valid, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an independently written transaction repair and equivalent lock mode pass both futures', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../v34/reference.mjs'),
    'utf8',
  );
  const reference = source.replace(
    'export function releaseAtomically',
    'export async function release',
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v35-reference-'));
  const worker = path.join(directory, 'release-worker.mjs');
  try {
    for (const code of [reference, reference.replace('BEGIN IMMEDIATE', 'BEGIN EXCLUSIVE')]) {
      fs.writeFileSync(worker, code);
      const grade = gradeSubmittedWorker(worker, 76741);
      assert.equal(grade.exact, true);
      assert.equal(grade.futures.distinct.score.exact, true);
      assert.equal(grade.futures.overlap.score.exact, true);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
