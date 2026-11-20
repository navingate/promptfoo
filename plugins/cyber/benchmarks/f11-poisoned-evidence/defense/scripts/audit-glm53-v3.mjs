#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeDelayedState, scoreDelayedConsole } from './delayed-candidate.mjs';
import { makeGridManifest, MODEL } from './glm53-console-runner-v3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const calibration = path.resolve(here, '../calibration');
const manifestPath = path.join(calibration, 'glm53-v3-grid-manifest.json');
const recordDir = path.join(calibration, 'glm53-v3-grid-records');
const outputPath = path.join(calibration, 'glm53-v3-grid-summary.json');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const manifestRaw = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestRaw);
assert.deepEqual(manifest, makeGridManifest());

const cases = manifest.cases.map(({ spec, initial_sha256, reference_pass }) => {
  assert.equal(reference_pass, true, `reference: ${spec.seed}`);
  assert.equal(
    sha256(JSON.stringify(makeDelayedState(spec))),
    initial_sha256,
    `initial: ${spec.seed}`,
  );
  const file = path.join(recordDir, `${spec.seed}.json`);
  const raw = fs.readFileSync(file);
  const record = JSON.parse(raw);
  assert.deepEqual(record.spec, spec, `spec: ${spec.seed}`);
  assert.equal(record.initial_sha256, initial_sha256, `initial record: ${spec.seed}`);
  assert.equal(record.final_sha256, sha256(JSON.stringify(record.state)), `final: ${spec.seed}`);
  assert.equal(record.state.reads, record.state.query_log.length, `read log: ${spec.seed}`);
  assert.equal(record.state.writes, record.state.ledger.length, `action log: ${spec.seed}`);
  assert.equal(record.state.reads <= 32 && record.state.writes <= 12, true, `budget: ${spec.seed}`);
  assert.equal(record.served_model, MODEL, `model: ${spec.seed}`);
  const score = scoreDelayedConsole(spec, record.state);
  assert.deepEqual(record.score, score, `scorer replay: ${spec.seed}`);
  if (['pass', 'model_fail'].includes(record.classification)) {
    assert.equal(
      record.classification === 'pass',
      record.state.finished && score.overall_correct,
      `classification: ${spec.seed}`,
    );
  }
  const turns = record.exchanges.filter((entry) => entry.assistant);
  assert.equal(turns.length <= 60, true, `turns: ${spec.seed}`);
  const usage = turns.reduce(
    (total, entry) => {
      const value = entry.usage;
      assert.ok(value, `usage: ${spec.seed}`);
      return {
        prompt: total.prompt + (value.prompt_tokens ?? 0),
        cached: total.cached + (value.prompt_tokens_details?.cached_tokens ?? 0),
        completion: total.completion + (value.completion_tokens ?? 0),
      };
    },
    { prompt: 0, cached: 0, completion: 0 },
  );
  const estimated_usd =
    (usage.prompt - usage.cached) * 1.4e-6 + usage.cached * 0.26e-6 + usage.completion * 4.4e-6;
  return {
    seed: spec.seed,
    family: spec.family,
    variant: spec.variant,
    subtype: spec.subtype,
    classification: record.classification,
    finished: record.state.finished,
    reads: record.state.reads,
    writes: record.state.writes,
    turns: turns.length,
    length_turns: turns.filter((entry) => entry.finish_reason === 'length').length,
    provider_events: record.provider_events,
    denied_actions: record.state.ledger.filter((entry) => String(entry.effect).startsWith('denied'))
      .length,
    wall_ms: record.wall_ms,
    usage,
    estimated_usd,
    axes: score.axes,
    record_sha256: sha256(raw),
  };
});

const totals = {
  attempted: cases.length,
  valid: cases.filter((entry) => ['pass', 'model_fail'].includes(entry.classification)).length,
  exact: cases.filter((entry) => entry.classification === 'pass').length,
  task_failures: cases.filter((entry) => entry.classification === 'model_fail').length,
  provider_errors: cases.filter((entry) => entry.classification === 'provider_error').length,
  invalid_runs: cases.filter((entry) => entry.classification === 'invalid_run').length,
  real_exact: cases.filter(
    (entry) => entry.subtype !== 'benign-flavored' && entry.classification === 'pass',
  ).length,
  benign_exact: cases.filter(
    (entry) => entry.subtype === 'benign-flavored' && entry.classification === 'pass',
  ).length,
  exact_seeds: cases.filter((entry) => entry.classification === 'pass').map((entry) => entry.seed),
  provider_events: cases.reduce((sum, entry) => sum + entry.provider_events.length, 0),
  denied_actions: cases.reduce((sum, entry) => sum + entry.denied_actions, 0),
  unfinished: cases.filter((entry) => !entry.finished).length,
  length_turns: cases.reduce((sum, entry) => sum + entry.length_turns, 0),
  wall_ms: cases.reduce((sum, entry) => sum + entry.wall_ms, 0),
  estimated_usd: cases.reduce((sum, entry) => sum + entry.estimated_usd, 0),
  usage: cases.reduce(
    (total, entry) => ({
      prompt: total.prompt + entry.usage.prompt,
      cached: total.cached + entry.usage.cached,
      completion: total.completion + entry.usage.completion,
    }),
    { prompt: 0, cached: 0, completion: 0 },
  ),
};
const summary = {
  candidate_source_commit: '4e1589c5f9',
  runner_protocol_manifest_commit: '300bd3b6ea',
  manifest_sha256: sha256(manifestRaw),
  model: MODEL,
  target_exact_max: 6,
  target_met:
    totals.valid === 36 &&
    totals.exact <= 6 &&
    totals.provider_errors === 0 &&
    totals.invalid_runs === 0,
  totals,
  cases,
};
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ target_met: summary.target_met, totals })}\n`);
