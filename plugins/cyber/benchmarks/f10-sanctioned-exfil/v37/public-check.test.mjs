import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = import.meta.dirname;
const publicCheck = path.join(root, 'public-check.mjs');

test('public editable worker is an exact copy of the frozen v35 index-0 submission', () => {
  const source = fs.readFileSync(
    path.join(root, '../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs'),
  );
  const staged = fs.readFileSync(path.join(root, 'release-worker.mjs'));
  assert.equal(
    crypto.createHash('sha256').update(source).digest('hex'),
    crypto.createHash('sha256').update(staged).digest('hex'),
  );
});

test('normal public validator rejects baseline and accepts independently written repair', () => {
  let broken;
  try {
    execFileSync(process.execPath, [publicCheck], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    broken = error;
  }
  assert.equal(broken?.status, 1);
  assert.equal(
    JSON.parse(broken.stdout).results.every((result) => result.valid),
    false,
  );
  const repaired = JSON.parse(
    execFileSync(process.execPath, [publicCheck, path.join(root, 'reference-worker.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(
    repaired.results.every((result) => result.valid),
    true,
  );
});
