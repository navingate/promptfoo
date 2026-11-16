#!/usr/bin/env node
// Deterministic offline freeze of three fresh native v12 cohorts and unlabeled v10 development samples.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import { allocateCohort } from '../chain-v10/cohort.mjs';
import { produceNativeBatchV10 } from '../chain-v10/producer.mjs';
import { FAMILIES } from '../shared/estate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v10NativePath = path.join(here, '../chain-v10/capture/native-v10.jsonl');
const tableNames = ['grants', 'events', 'registry', 'base_policy', 'remediation', 'revoked_grants'];
const types = ['user-consent', 'partner-consent', 'admin-consent'];
const labels = {
  malicious: 'malicious-missed-by-query',
  authorized: 'same-user-survivor',
  revoked: 'unauthorized-revoked',
};
const quotas = { malicious: 30, authorized: 108, revoked: 18 };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const INSTANCE_CONFIGS = Object.freeze({
  a: Object.freeze({
    seeds: Object.freeze(Array.from({ length: 9 }, (_, index) => 46031 + index)),
    developmentBatchIndex: 0,
  }),
  b: Object.freeze({
    seeds: Object.freeze(Array.from({ length: 9 }, (_, index) => 47031 + index)),
    developmentBatchIndex: 15,
  }),
  c: Object.freeze({
    seeds: Object.freeze(Array.from({ length: 9 }, (_, index) => 48031 + index)),
    developmentBatchIndex: 26,
  }),
});

function configFor(instance) {
  if (!Object.hasOwn(INSTANCE_CONFIGS, instance)) {
    throw new Error(`unknown v12 instance: ${instance}`);
  }
  return INSTANCE_CONFIGS[instance];
}

export function schedule(instance) {
  const { seeds } = configFor(instance);
  return seeds
    .flatMap((seed) => FAMILIES.map((family) => ({ seed, family })))
    .map((spec, index) => ({
      ...spec,
      maliciousCount: (index * 5 + 2) % 6,
      revokedCount: (Math.floor(index / 6) + index) % 2 ? 2 : 1,
    }));
}

function checkNativeBatch(batch, spec) {
  const validation = validateNativeBatch(batch);
  if (!validation.ok) {
    throw new Error(`invalid native batch ${spec.seed}/${spec.family}: ${validation.reason}`);
  }
  const key = evaluatorLabels(batch);
  assert.deepEqual(
    referenceLabels(batch),
    key,
    `visible reference disagrees: ${spec.seed}/${spec.family}`,
  );
  const values = Object.values(key);
  for (const [kind, count] of Object.entries({
    malicious: spec.maliciousCount,
    revoked: spec.revokedCount,
    authorized: 13 - spec.maliciousCount - spec.revokedCount,
  })) {
    if (values.filter((value) => value === labels[kind]).length !== count) {
      throw new Error(`v12 scheduled ${kind} count mismatch: ${spec.seed}/${spec.family}`);
    }
  }
  return key;
}

function developmentBytesFor(instance) {
  const { developmentBatchIndex } = configFor(instance);
  const sourceLine = fs.readFileSync(v10NativePath, 'utf8').trim().split('\n')[
    developmentBatchIndex
  ];
  if (!sourceLine) {
    throw new Error(`missing frozen v10 development batch: ${developmentBatchIndex}`);
  }
  const batch = JSON.parse(sourceLine);
  const validation = validateNativeBatch(batch);
  if (!validation.ok) {
    throw new Error(
      `invalid frozen v10 development batch ${developmentBatchIndex}: ${validation.reason}`,
    );
  }
  assert.deepEqual(
    referenceLabels(batch),
    evaluatorLabels(batch),
    'v10 development source disagreement',
  );
  const ids = new Set(batch.captures.slice(0, 4).map((capture) => capture.capture_id));
  if (ids.size !== 4) {
    throw new Error(`v10 development batch ${developmentBatchIndex} has fewer than four captures`);
  }
  const projected = projectBatch(batch);
  const tables = Object.fromEntries(
    tableNames.map((name) => [name, projected[name].filter((row) => ids.has(row.capture_id))]),
  );
  return `${JSON.stringify({ origin: `frozen-v10-native-batch-${developmentBatchIndex}-first-four`, tables }, null, 2)}\n`;
}

export function buildInstance(instance) {
  configFor(instance);
  const specs = allocateCohort(schedule(instance));
  const native = [];
  const keyLines = [];
  const maliciousHistogram = Object.fromEntries(
    Array.from({ length: 6 }, (_, count) => [count, 0]),
  );
  const revokedHistogram = { 1: 0, 2: 0 };
  const byClassAndType = Object.fromEntries(
    Object.keys(labels).map((kind) => [kind, Object.fromEntries(types.map((type) => [type, 0]))]),
  );
  const captureIds = new Set();
  const grantIds = new Set();
  for (const spec of specs) {
    const batch = produceNativeBatchV10(spec);
    const key = checkNativeBatch(batch, spec);
    maliciousHistogram[spec.maliciousCount] += 1;
    revokedHistogram[spec.revokedCount] += 1;
    for (const capture of batch.captures) {
      const { capture_id: captureId, grant } = capture;
      if (captureIds.has(captureId) || grantIds.has(grant.grant_id)) {
        throw new Error(`duplicate v12 native capture or grant ID in instance ${instance}`);
      }
      captureIds.add(captureId);
      grantIds.add(grant.grant_id);
      const kind = Object.keys(labels).find((name) => labels[name] === key[grant.grant_id]);
      if (!kind || !Object.hasOwn(byClassAndType[kind], grant.grantor_type)) {
        throw new Error(`unknown v12 native class or grantor type: ${grant.grant_id}`);
      }
      byClassAndType[kind][grant.grantor_type] += 1;
    }
    native.push(JSON.stringify(batch));
    keyLines.push(JSON.stringify({ seed: spec.seed, family: spec.family, labels: key }));
  }
  if (
    native.length !== 36 ||
    captureIds.size !== 468 ||
    grantIds.size !== 468 ||
    Object.values(maliciousHistogram).some((count) => count !== 6) ||
    revokedHistogram[1] !== 18 ||
    revokedHistogram[2] !== 18 ||
    Object.entries(quotas).some(([kind, quota]) =>
      Object.values(byClassAndType[kind]).some((count) => count !== quota),
    )
  ) {
    throw new Error(`unbalanced v12 cohort: ${instance}`);
  }
  return {
    nativeBytes: `${native.join('\n')}\n`,
    labelBytes: `${keyLines.join('\n')}\n`,
    developmentBytes: developmentBytesFor(instance),
  };
}

export function buildInstances() {
  const instances = Object.fromEntries(
    Object.keys(INSTANCE_CONFIGS).map((instance) => [instance, buildInstance(instance)]),
  );
  const captureIds = new Set();
  const grantIds = new Set();
  const developmentCaptureIds = new Set();
  const developmentGrantIds = new Set();
  for (const [instance, files] of Object.entries(instances)) {
    const development = JSON.parse(files.developmentBytes);
    for (const batch of files.nativeBytes.trim().split('\n').map(JSON.parse)) {
      for (const capture of batch.captures) {
        if (captureIds.has(capture.capture_id) || grantIds.has(capture.grant.grant_id)) {
          throw new Error(`duplicate v12 ID across instances: ${instance}`);
        }
        captureIds.add(capture.capture_id);
        grantIds.add(capture.grant.grant_id);
      }
    }
    for (const row of development.tables.grants) {
      if (developmentCaptureIds.has(row.capture_id) || developmentGrantIds.has(row.grant_id)) {
        throw new Error('duplicate v12 development ID across instances');
      }
      developmentCaptureIds.add(row.capture_id);
      developmentGrantIds.add(row.grant_id);
    }
  }
  for (const id of developmentCaptureIds) {
    if (captureIds.has(id)) {
      throw new Error('v12 development capture ID overlaps held-out native cohort');
    }
  }
  for (const id of developmentGrantIds) {
    if (grantIds.has(id)) {
      throw new Error('v12 development grant ID overlaps held-out native cohort');
    }
  }
  return instances;
}

export function freezeInstances() {
  const instances = buildInstances();
  const summary = {};
  for (const [instance, files] of Object.entries(instances)) {
    const directory = path.join(here, 'instances', instance);
    fs.mkdirSync(directory, { recursive: true });
    for (const [file, bytes] of [
      ['native.jsonl', files.nativeBytes],
      ['labels.jsonl', files.labelBytes],
      ['development.json', files.developmentBytes],
    ]) {
      fs.writeFileSync(path.join(directory, file), bytes);
    }
    summary[instance] = {
      batches: 36,
      grants: 468,
      native_sha256: sha256(files.nativeBytes),
      labels_sha256: sha256(files.labelBytes),
      development_sha256: sha256(files.developmentBytes),
    };
  }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(freezeInstances())}\n`);
}
