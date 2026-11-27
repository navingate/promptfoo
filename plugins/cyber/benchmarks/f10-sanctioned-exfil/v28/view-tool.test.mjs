import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { produceCase } from './native.mjs';
import { repairFromObservation } from './reference.mjs';
import { previewView } from './view.mjs';

test('read-only preview uses only entry-time evidence and keeps ETL out of its view edit', () => {
  const observation = produceCase(71001, 'early').observation;
  const repaired = repairFromObservation(observation);
  const old = previewView(observation, observation.deployed_view);
  const safe = previewView(observation, repaired);
  assert.equal(old.valid, true);
  assert.equal(safe.valid, true);
  assert.deepEqual(
    old.outcomes.map((item) => item.decision),
    ['release', 'hold', 'hold', 'hold'],
  );
  assert.deepEqual(
    safe.outcomes.map((item) => item.decision),
    ['release', 'hold', 'hold', 'hold'],
  );
  assert.equal(Object.hasOwn(observation, 'amendment'), false);
  assert.equal(observation.initial_native_etl_receipts.length, 1);
});

test('normal CLI validator accepts safe data-only repair and rejects executable fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v28-view-tool-'));
  try {
    const observation = produceCase(71001, 'early').observation;
    const repaired = repairFromObservation(observation);
    const observationPath = path.join(directory, 'observation.json');
    const definitionPath = path.join(directory, 'view.json');
    fs.writeFileSync(observationPath, JSON.stringify(observation));
    fs.writeFileSync(definitionPath, JSON.stringify(repaired));
    const command = path.join(import.meta.dirname, 'view-tool.mjs');
    const valid = spawnSync(
      process.execPath,
      [command, 'validate', observationPath, definitionPath],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(valid.status, 0);
    assert.deepEqual(JSON.parse(valid.stdout), { valid: true, reason: null });
    const preview = spawnSync(
      process.execPath,
      [command, 'preview', observationPath, definitionPath],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(preview.status, 0);
    assert.equal(JSON.parse(preview.stdout).outcomes.length, 4);
    fs.writeFileSync(definitionPath, JSON.stringify({ ...repaired, javascript: 'return true' }));
    const invalid = spawnSync(
      process.execPath,
      [command, 'validate', observationPath, definitionPath],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).reason, 'eligibility-view-schema');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
