#!/usr/bin/env node
// Post-score, read-only provenance and native-ledger analysis of the frozen v4 captures.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { analyzeDefense, analyzeOffense } from '../v3/analyze.mjs';

function readCapture(path) {
  const bytes = fs.readFileSync(path);
  return {
    capture: JSON.parse(bytes),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

export function combineOffense(initial, retry) {
  const expectedSeeds = Array.from({ length: 36 }, (_, i) => 10001 + i);
  assert.deepEqual(initial.config.seeds, expectedSeeds);
  assert.equal(initial.summary.mode, 'offense');
  assert.equal(retry.summary.mode, 'offense');
  assert.equal(initial.summary.model, retry.summary.model);
  assert.equal(initial.summary.endpoint_id, retry.summary.endpoint_id);
  for (const field of ['max_tokens', 'timeout_ms', 'max_turns', 'concurrency', 'temperature']) {
    assert.equal(initial.config[field], retry.config[field], `changed ${field}`);
  }
  assert.deepEqual(initial.config.families, retry.config.families);
  assert.equal(initial.results.length, 36);
  const errors = initial.results.filter((run) => run.classification === 'provider_error');
  assert.deepEqual(
    errors.map((run) => run.spec.seed),
    retry.config.seeds,
  );
  assert.equal(retry.results.length, errors.length);
  const bySeed = new Map(retry.results.map((run) => [run.spec.seed, run]));
  assert.equal(bySeed.size, errors.length);
  const results = initial.results.map((run, index) => {
    assert.equal(run.spec.seed, expectedSeeds[index]);
    if (run.classification !== 'provider_error') {
      return run;
    }
    const replacement = bySeed.get(run.spec.seed);
    assert.ok(replacement);
    assert.deepEqual(replacement.spec, run.spec);
    return replacement;
  });
  return {
    results,
    provenance: {
      initial_model_outcomes: 36 - errors.length,
      retried_provider_error_slots: errors.length,
    },
  };
}

if (process.argv[1]?.endsWith('/analyze.mjs')) {
  const [initialPath, retryPath, defensePath] = process.argv.slice(2);
  if (!initialPath || !retryPath || !defensePath) {
    throw new Error('usage: node analyze.mjs /tmp/initial.json /tmp/retry.json /tmp/defense.json');
  }
  const initial = readCapture(initialPath);
  const retry = readCapture(retryPath);
  const defense = readCapture(defensePath);
  const combined = combineOffense(initial.capture, retry.capture);
  const offenseAnalysis = analyzeOffense(combined);
  const defenseAnalysis = analyzeDefense(defense.capture);
  process.stdout.write(
    `${JSON.stringify(
      {
        capture_sha256: {
          initial_offense: initial.sha256,
          provider_retry: retry.sha256,
          defense: defense.sha256,
        },
        provenance: combined.provenance,
        offense: offenseAnalysis,
        offense_floor_valid: offenseAnalysis.valid_final_decisions >= 30,
        defense: defenseAnalysis,
      },
      null,
      2,
    )}\n`,
  );
}
