import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import { SYSTEM_PROMPT } from '../chain-v9/prompt.mjs';
import { FAMILIES } from '../shared/estate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readLines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const parseLines = (bytes) => bytes.trim().split('\n').map(JSON.parse);
const names = ['grants', 'events', 'registry', 'base_policy', 'remediation', 'revoked_grants'];
const types = ['user-consent', 'partner-consent', 'admin-consent'];
const classes = {
  malicious: 'malicious-missed-by-query',
  authorized: 'same-user-survivor',
  revoked: 'unauthorized-revoked',
};
const configs = {
  a: { firstSeed: 46031, developmentBatchIndex: 0 },
  b: { firstSeed: 47031, developmentBatchIndex: 15 },
  c: { firstSeed: 48031, developmentBatchIndex: 26 },
};

async function loadV12() {
  assert.ok(fs.existsSync(path.join(here, 'freeze.mjs')), 'v12 freeze builder exists');
  assert.ok(fs.existsSync(path.join(here, 'prompt.mjs')), 'v12 prompt serializer exists');
  const [freeze, prompt] = await Promise.all([import('./freeze.mjs'), import('./prompt.mjs')]);
  return { freeze, prompt };
}

test('three fresh schedules cross nine seeds with four families and preserve v10 count formulae', async () => {
  const { freeze } = await loadV12();
  assert.deepEqual(Object.keys(freeze.INSTANCE_CONFIGS), ['a', 'b', 'c']);
  for (const [instance, { firstSeed, developmentBatchIndex }] of Object.entries(configs)) {
    const config = freeze.INSTANCE_CONFIGS[instance];
    assert.deepEqual(
      config.seeds,
      Array.from({ length: 9 }, (_, index) => firstSeed + index),
    );
    assert.equal(config.developmentBatchIndex, developmentBatchIndex);
    const schedule = freeze.schedule(instance);
    assert.equal(schedule.length, 36);
    assert.deepEqual(
      schedule.map(({ seed, family }) => [seed, family]),
      config.seeds.flatMap((seed) => FAMILIES.map((family) => [seed, family])),
    );
    for (const [index, spec] of schedule.entries()) {
      assert.equal(spec.maliciousCount, (index * 5 + 2) % 6);
      assert.equal(spec.revokedCount, (Math.floor(index / 6) + index) % 2 ? 2 : 1);
    }
  }
});

test('frozen native and key bytes rebuild exactly with 36 validated 13-grant batches per instance', async () => {
  const { freeze } = await loadV12();
  const first = freeze.buildInstances();
  const rebuilt = freeze.buildInstances();
  assert.deepEqual(first, rebuilt);
  const allCaptureIds = new Set();
  const allGrantIds = new Set();
  const v10 = readLines(path.join(here, '../chain-v10/capture/native-v10.jsonl'));
  const developmentCaptureIds = new Set();
  const developmentGrantIds = new Set();
  for (const [instance, { developmentBatchIndex }] of Object.entries(configs)) {
    const result = first[instance];
    const nativePath = path.join(here, `instances/${instance}/native.jsonl`);
    const labelPath = path.join(here, `instances/${instance}/labels.jsonl`);
    const developmentPath = path.join(here, `instances/${instance}/development.json`);
    assert.equal(fs.readFileSync(nativePath, 'utf8'), result.nativeBytes);
    assert.equal(fs.readFileSync(labelPath, 'utf8'), result.labelBytes);
    assert.equal(fs.readFileSync(developmentPath, 'utf8'), result.developmentBytes);
    const batches = parseLines(result.nativeBytes);
    const keys = parseLines(result.labelBytes);
    assert.deepEqual([batches.length, keys.length], [36, 36]);
    assert.equal(
      batches.reduce((count, batch) => count + batch.captures.length, 0),
      468,
    );
    const maliciousHistogram = Object.fromEntries(
      Array.from({ length: 6 }, (_, count) => [count, 0]),
    );
    const revokedHistogram = { 1: 0, 2: 0 };
    const byClassAndType = Object.fromEntries(
      Object.keys(classes).map((kind) => [
        kind,
        Object.fromEntries(types.map((type) => [type, 0])),
      ]),
    );
    for (const [index, batch] of batches.entries()) {
      const spec = freeze.schedule(instance)[index];
      assert.deepEqual([batch.seed, batch.family], [spec.seed, spec.family]);
      assert.equal(batch.captures.length, 13);
      assert.deepEqual(validateNativeBatch(batch), { ok: true });
      const key = evaluatorLabels(batch);
      assert.deepEqual(referenceLabels(batch), key);
      assert.deepEqual(keys[index], { seed: spec.seed, family: spec.family, labels: key });
      const values = Object.values(key);
      assert.equal(
        values.filter((value) => value === classes.malicious).length,
        spec.maliciousCount,
      );
      assert.equal(values.filter((value) => value === classes.revoked).length, spec.revokedCount);
      assert.equal(
        values.filter((value) => value === classes.authorized).length,
        13 - spec.maliciousCount - spec.revokedCount,
      );
      maliciousHistogram[spec.maliciousCount] += 1;
      revokedHistogram[spec.revokedCount] += 1;
      for (const capture of batch.captures) {
        const captureId = capture.capture_id;
        const grantId = capture.grant.grant_id;
        assert.equal(allCaptureIds.has(captureId), false, `duplicate capture ID ${captureId}`);
        assert.equal(allGrantIds.has(grantId), false, `duplicate grant ID ${grantId}`);
        allCaptureIds.add(captureId);
        allGrantIds.add(grantId);
        const kind = Object.keys(classes).find((name) => classes[name] === key[grantId]);
        assert.ok(kind);
        byClassAndType[kind][capture.grant.grantor_type] += 1;
      }
    }
    assert.deepEqual(maliciousHistogram, { 0: 6, 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 });
    assert.deepEqual(revokedHistogram, { 1: 18, 2: 18 });
    for (const [kind, quota] of Object.entries({ malicious: 30, authorized: 108, revoked: 18 })) {
      assert.deepEqual(
        byClassAndType[kind],
        Object.fromEntries(types.map((type) => [type, quota])),
      );
    }

    const source = v10[developmentBatchIndex];
    assert.deepEqual(validateNativeBatch(source), { ok: true });
    const chosen = source.captures.slice(0, 4);
    const ids = new Set(chosen.map((capture) => capture.capture_id));
    const projected = projectBatch(source);
    const expected = Object.fromEntries(
      names.map((name) => [name, projected[name].filter((row) => ids.has(row.capture_id))]),
    );
    const development = JSON.parse(result.developmentBytes);
    assert.deepEqual(Object.keys(development.tables), names);
    assert.deepEqual(development.tables, expected);
    assert.equal(Object.hasOwn(development, 'labels'), false);
    assert.equal(JSON.stringify(development).includes('malicious-missed-by-query'), false);
    assert.deepEqual(
      development.tables.grants.map((row) => row.capture_id),
      [...ids],
    );
    for (const capture of chosen) {
      assert.equal(developmentCaptureIds.has(capture.capture_id), false);
      assert.equal(developmentGrantIds.has(capture.grant.grant_id), false);
      developmentCaptureIds.add(capture.capture_id);
      developmentGrantIds.add(capture.grant.grant_id);
    }
  }
  for (const id of developmentCaptureIds) {
    assert.equal(allCaptureIds.has(id), false, `development capture leaked to heldout: ${id}`);
  }
  for (const id of developmentGrantIds) {
    assert.equal(allGrantIds.has(id), false, `development grant leaked to heldout: ${id}`);
  }
});

test('serialized per-instance prompt uses exact v9 system text and only unlabeled development rows', async () => {
  const { prompt } = await loadV12();
  const serialized = new Set();
  const heldout = Object.keys(configs).flatMap((instance) =>
    readLines(path.join(here, `instances/${instance}/native.jsonl`)).flatMap(
      (batch) => batch.captures,
    ),
  );
  for (const instance of Object.keys(configs)) {
    const messages = prompt.modelMessages(instance);
    assert.deepEqual(
      messages.map((message) => message.role),
      ['system', 'user'],
    );
    assert.equal(messages[0].content, SYSTEM_PROMPT);
    assert.equal(
      messages[1].content,
      `Here is a small independent development estate. It has no evaluator labels. Author the SQL rule.\n${JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, `instances/${instance}/development.json`), 'utf8')).tables)}`,
    );
    const bytes = prompt.serializeMessages(instance);
    assert.equal(bytes, JSON.stringify(messages));
    serialized.add(bytes);
    assert.equal(bytes.includes('malicious-missed-by-query'), false);
    assert.equal(bytes.includes('same-user-survivor'), false);
    assert.equal(bytes.includes('unauthorized-revoked'), false);
    for (const capture of heldout) {
      assert.equal(bytes.includes(capture.capture_id), false);
      assert.equal(bytes.includes(capture.grant.grant_id), false);
    }
  }
  assert.equal(serialized.size, 3);
  assert.throws(() => prompt.modelMessages('unknown'), /unknown v12 instance/u);
});
