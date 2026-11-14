import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBatch } from './capture-consumer.mjs';
import { CAPTURE_SEEDS, writeCorpus } from './capture-producer.mjs';
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
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v15-runner-evidence-'));
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
  for (const seed of CAPTURE_SEEDS.slice(0, 12)) {
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
  const batch = loadBatch(CAPTURE_SEEDS[0], evidenceDir);
  const labels = referenceDefense(batch);
  assert.deepEqual(scorePairAccuracy(batch, labels), { pair_exact: 2, pair_total: 2 });
  labels[batch._pairFlowIds.get('alternate-over')[0]] = 'benign';
  assert.deepEqual(scorePairAccuracy(batch, labels), { pair_exact: 1, pair_total: 2 });
  assert.deepEqual(scorePairAccuracy(batch, null), { pair_exact: 0, pair_total: 2 });
});

const liveCfg = () => ({ model: 'test-model', screenDeadlineMs: Date.now() + 60000 });
const response = (text) => ({
  kind: 'ok',
  text,
  served_model: 'test-model',
  finish_reason: 'stop',
});

test('thrown provider request becomes sanitized provider error without losing the slot', async () => {
  const secret = 'sk-sensitive-example';
  const result = await runDefenseCase(CAPTURE_SEEDS[0], { evidenceDir }, liveCfg(), async () => {
    throw new Error(`HTTP 401 ${secret} request body`);
  });
  assert.equal(result.classification, 'provider_error');
  assert.equal(result.reason, 'request-exception');
  assert.deepEqual([result.pair_exact, result.pair_total], [0, 2]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('request body'), false);
});

test('bad evidence fails before provider traffic', async () => {
  let calls = 0;
  await assert.rejects(
    runDefenseCase(
      CAPTURE_SEEDS[0],
      { evidenceDir: path.join(evidenceDir, 'missing') },
      liveCfg(),
      async () => {
        calls += 1;
        return response('{}');
      },
    ),
  );
  assert.equal(calls, 0);
});

test('parsed object with missing or extra flow keys is label-schema invalid after repair', async () => {
  const correct = referenceDefense(loadBatch(CAPTURE_SEEDS[0], evidenceDir));
  for (const text of ['{}', JSON.stringify({ ...correct, extra: 'benign' })]) {
    let calls = 0;
    const result = await runDefenseCase(CAPTURE_SEEDS[0], { evidenceDir }, liveCfg(), async () => {
      calls += 1;
      return response(text);
    });
    assert.equal(calls, 2);
    assert.equal(result.classification, 'invalid_run');
    assert.equal(result.reason, 'label-schema');
    assert.equal(result.parsed, true);
    assert.equal(result.score.valid, false);
    assert.deepEqual([result.pair_exact, result.pair_total], [0, 2]);
  }
});

test('non-JSON after repair remains off-grammar and unparsed', async () => {
  const result = await runDefenseCase(CAPTURE_SEEDS[0], { evidenceDir }, liveCfg(), async () =>
    response('not json'),
  );
  assert.equal(result.classification, 'model_fail');
  assert.equal(result.reason, 'off-grammar');
  assert.equal(result.parsed, false);
  assert.deepEqual([result.pair_exact, result.pair_total], [0, 2]);
});

test('raw output requires safe local path and stays private', () => {
  assert.throws(() => assertSafeOutputPath(path.join(here, 'raw.json')), /outside the repository/u);
  const output = path.join(os.tmpdir(), `f10-v15-private-${crypto.randomUUID()}.json`);
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
