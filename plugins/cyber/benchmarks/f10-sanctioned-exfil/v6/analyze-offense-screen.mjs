#!/usr/bin/env node
// Read-only postscore audit. The 37th raw record is disclosed but never scored.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeOffense, reconstructOffenseRun } from '../v3/analyze.mjs';
import { runTerminalShortcut } from './terminal-shortcuts.mjs';

const EXPECTED_RAW_SHA256 = '4038a666af05c5edbab1c16f35a9a5f4d0ed6af7f2ba68bf318ea300f608c974';
const SEEDS = Array.from({ length: 36 }, (_, index) => 13001 + index);

export function auditCapture(capture, rawSha256) {
  assert.equal(rawSha256, EXPECTED_RAW_SHA256, 'raw offense capture hash mismatch');
  assert.equal(capture.mode ?? capture.summary?.mode, 'offense');
  assert.equal(capture.summary.model, 'zai.glm-5');
  assert.equal(capture.summary.endpoint_id, 'aws-bedrock-mantle-ap-south-1');
  assert.equal(capture.results.length, 37, 'unexpected raw case count');
  assert.deepEqual(capture.config.seeds, [...SEEDS, 0], 'seed sequence changed');
  const scored = capture.results.slice(0, 36);
  for (let index = 0; index < SEEDS.length; index += 1) {
    assert.equal(scored[index].spec.seed, SEEDS[index]);
    assert.equal(scored[index].spec.family, 'multi-identity-fanout');
    for (const turn of scored[index].transcript ?? []) {
      if (turn.served_model) {
        assert.equal(turn.served_model, capture.summary.model);
      }
    }
  }
  assert.equal(capture.results[36].spec.seed, 0, 'extra seed changed');
  const analysis = analyzeOffense({ ...capture, results: scored });
  const native = scored.map((result) => ({
    seed: result.spec.seed,
    classification: result.classification,
    reason: result.reason ?? null,
    ...reconstructOffenseRun(result),
  }));
  const transport = scored.reduce(
    (count, result) => {
      for (const turn of result.transcript ?? []) {
        if (turn.transport) {
          count.requests += 1;
          count.retried += Number(turn.transport.attempts > 1);
          for (const reason of turn.transport.transient_errors) {
            count.transient[reason] = (count.transient[reason] ?? 0) + 1;
          }
        }
      }
      return count;
    },
    { requests: 0, retried: 0, transient: {} },
  );
  const rules = ['one', 'first-two', 'largest-two', 'first-different', 'complementary'];
  const controls = Object.fromEntries(
    rules.map((rule) => [
      rule,
      SEEDS.filter((seed) => runTerminalShortcut(seed, rule).score.success).length,
    ]),
  );
  return {
    raw_sha256: rawSha256,
    raw_total: capture.results.length,
    scored_seed_range: [SEEDS[0], SEEDS.at(-1)],
    excluded_extra_seed: 0,
    analysis,
    transport,
    controls,
    top_uncovered: [...native]
      .sort((left, right) => right.max_uncovered_ratio - left.max_uncovered_ratio)
      .slice(0, 5)
      .map((result) => ({
        seed: result.seed,
        uncovered: result.max_uncovered,
        limit: result.aggregate_limit,
        ratio: result.max_uncovered_ratio,
        receipts: result.completed_receipts,
        actors: result.published_actor_count,
        complementary_pair: result.complementary_pair_published,
        cited_stages: result.cited_stage_count,
      })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawFile = process.argv[2];
  if (!rawFile) {
    throw new Error('usage: node analyze-offense-screen.mjs /tmp/f10-v6-glm5-offense.json');
  }
  const raw = fs.readFileSync(rawFile);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const result = auditCapture(JSON.parse(raw), sha);
  result.raw_mode = fs.statSync(rawFile).mode & 0o777;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
