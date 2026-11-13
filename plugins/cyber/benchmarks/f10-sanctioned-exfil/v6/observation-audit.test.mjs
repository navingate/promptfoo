import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch, serializeObservation } from './capture-consumer.mjs';
import { buildObservationManifest } from './observation-audit.mjs';

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('exact staged defense context matches its frozen inventory for every case', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(evidenceDir, 'observation-manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest, buildObservationManifest(manifest.consumer_source_commit));
  assert.deepEqual(Object.keys(manifest.categories).sort(), [
    'artifacts',
    'exposed_environment',
    'feedback',
    'files',
    'prompts',
    'serialized_results',
    'telemetry',
    'tool_descriptions',
  ]);
  for (let seed = 12001; seed <= 12012; seed += 1) {
    const batch = loadBatch(seed);
    const staged = serializeObservation(batch);
    const instance = manifest.instances.find((entry) => entry.seed === seed);
    assert.equal(hash(staged), instance.user_message_sha256);
    assert.equal(JSON.stringify(JSON.parse(staged)), staged);
    for (const forbidden of ['"labels"', '"nonce"', '"sink"', '"value"', '"terminal"']) {
      assert.equal(staged.includes(forbidden), false, `seed ${seed}: ${forbidden}`);
    }
  }
});
