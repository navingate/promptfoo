import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch } from './capture-consumer.mjs';
import { writeCorpus } from './capture-producer.mjs';
import { referenceDefense } from './defense.mjs';
import {
  assertSafeOutputPath,
  runDefenseCase,
  scorePairAccuracy,
  writeOutput,
} from './defense-runner.mjs';
import { buildObservationManifest } from './observation-audit.mjs';

const source = 'a'.repeat(40);
const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v14-runner-evidence-'));
fs.copyFileSync(
  path.join(here, 'evidence/field-lineage.json'),
  path.join(evidenceDir, 'field-lineage.json'),
);
writeCorpus(source, evidenceDir);
fs.writeFileSync(
  path.join(evidenceDir, 'observation-manifest.json'),
  `${JSON.stringify(buildObservationManifest(source, evidenceDir), null, 2)}\n`,
);
test.after(() => fs.rmSync(evidenceDir, { recursive: true, force: true }));

test('mock reference classifies all 12 provisional batches without provider calls', async () => {
  let calls = 0;
  for (let seed = 14001; seed <= 14012; seed += 1) {
    const result = await runDefenseCase(seed, { mock: true, evidenceDir }, {}, () => {
      calls += 1;
    });
    assert.equal(result.classification, 'pass');
    assert.equal(result.score.exact, true);
    assert.equal(result.pair_exact, 2);
    assert.equal(result.pair_total, 2);
  }
  assert.equal(calls, 0);
});

test('paired-case score falls when either member has a wrong label and invalid output scores zero', () => {
  const batch = loadBatch(14001, evidenceDir);
  const labels = referenceDefense(batch);
  assert.deepEqual(scorePairAccuracy(batch, labels), { pair_exact: 2, pair_total: 2 });
  labels[batch._pairFlowIds.get('alternate-over')[0]] = 'benign';
  assert.deepEqual(scorePairAccuracy(batch, labels), { pair_exact: 1, pair_total: 2 });
  assert.deepEqual(scorePairAccuracy(batch, null), { pair_exact: 0, pair_total: 2 });
});

test('raw output requires safe local path and stays private', () => {
  assert.throws(() => assertSafeOutputPath(path.join(here, 'raw.json')), /outside the repository/u);
  const output = path.join(os.tmpdir(), `f10-v14-private-${crypto.randomUUID()}.json`);
  try {
    writeOutput(output, { sample: true });
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => writeOutput(output, {}), /already exists/u);
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test('direct runner execution cannot start an unpaced screen', () => {
  const result = spawnSync(process.execPath, [path.join(here, 'defense-runner.mjs'), '--bogus'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
