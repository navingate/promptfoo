import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('freeze binds a fresh observation and evaluator sidecars to the source commit', async () => {
  const { freezeCandidate } = await import('./freeze.mjs').catch(() => ({}));
  assert.equal(typeof freezeCandidate, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v17-freeze-'));
  try {
    const destination = path.join(root, 'evidence');
    const manifest = freezeCandidate(destination, 'a'.repeat(40), [0]);
    assert.equal(manifest.source_commit, 'a'.repeat(40));
    assert.equal(manifest.files.length, 3);
    const observation = fs.readFileSync(path.join(destination, 'observation-0.json'), 'utf8');
    assert.doesNotMatch(observation, /"labels"|"proofs"|"sink"/u);
    assert.throws(() => freezeCandidate(destination, 'a'.repeat(40), [0]), /exists/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
