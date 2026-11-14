#!/usr/bin/env node
// Defense-only Cloudflare screen. The local reference mode makes no provider requests.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUEST_WALL_MS, RETRY_DELAYS_MS } from '../v5/transport.mjs';
import { ENDPOINT_ID, MODEL, verifyEndpointBinding } from '../v7/cloudflare-screen.mjs';
import { MIN_REQUEST_GAP_MS, makePacedRequest } from '../v8/paced-transport.mjs';
import { DEFENSE_PROMPT } from './defense.mjs';
import { assertSafeOutputPath, runDefenseCase, writeOutput } from './defense-runner.mjs';

export const DEFENSE_CASE_WALL_MS = 600000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function planDefense() {
  return {
    task: 'defense',
    seeds: Array.from({ length: 12 }, (_, index) => 14001 + index),
    maxTokens: 16384,
    reasoningEffort: 'low',
    caseWallMs: DEFENSE_CASE_WALL_MS,
  };
}

export function parseArgs(argv) {
  const args = { mock: false, plan: planDefense(), evidenceDir: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mock-reference') {
      args.mock = true;
    } else if (flag === '--output' || flag === '--evidence-dir') {
      const value = argv[++index];
      if (!value) {
        throw new Error(`missing value for ${flag}`);
      }
      if (flag === '--output') {
        args.output = value;
      } else {
        args.evidenceDir = path.resolve(value);
      }
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  args.output ??= `/tmp/f10-v14-cf-${args.mock ? 'reference' : 'glm53'}-defense.json`;
  args.output = assertSafeOutputPath(args.output);
  if (fs.existsSync(args.output)) {
    throw new Error('output already exists; choose a new path');
  }
  return args;
}

export function validateLiveEnv(env, verify = verifyEndpointBinding) {
  verify(env);
  if (!env.CLOUDFLARE_API_KEY) {
    throw new Error('set CLOUDFLARE_API_KEY');
  }
}

const LABELS = ['cumulative-exfil', 'sanctioned-bulk', 'ambiguous', 'benign'];

export function summarizeDefenseResults(results, args, cfg) {
  const validScores = results.map((result) => result.score).filter((score) => score?.valid);
  const confusion = Object.fromEntries(
    LABELS.map((truth) => [truth, Object.fromEntries(LABELS.map((prediction) => [prediction, 0]))]),
  );
  for (const score of validScores) {
    for (const truth of LABELS) {
      for (const prediction of LABELS) {
        confusion[truth][prediction] += score.confusion[truth][prediction];
      }
    }
  }
  const truePositives = validScores.reduce((sum, score) => sum + score.true_positives, 0);
  const falsePositives = validScores.reduce((sum, score) => sum + score.false_positives, 0);
  const falseNegatives = validScores.reduce((sum, score) => sum + score.false_negatives, 0);
  const offGrammar = results.filter((result) => result.reason === 'off-grammar').length;
  const invalidRuns = results.filter((result) => result.classification === 'invalid_run').length;
  const providerErrors = results.filter(
    (result) => result.classification === 'provider_error',
  ).length;
  return {
    mode: 'defense',
    model: args.mock ? 'reference' : cfg.model,
    endpoint_id: args.mock ? 'local-reference' : cfg.endpointId,
    completed_slots: results.length,
    planned_slots: args.plan.seeds.length,
    exact_batches: results.filter((result) => result.classification === 'pass').length,
    valid_batches: validScores.length,
    parsed_batches: results.filter((result) => result.parsed === true).length,
    model_fail_batches: results.filter(
      (result) => result.classification === 'model_fail' && result.reason !== 'off-grammar',
    ).length,
    invalid_slots: offGrammar + invalidRuns + providerErrors,
    off_grammar: offGrammar,
    invalid_runs: invalidRuns,
    provider_errors: providerErrors,
    confusion,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    precision:
      truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives),
    recall:
      truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mock) {
    validateLiveEnv(process.env);
  }
  const cfg = {
    baseUrl: process.env.CLOUDFLARE_OPENAI_BASE_URL,
    endpointId: ENDPOINT_ID,
    model: MODEL,
    apiKey: process.env.CLOUDFLARE_API_KEY,
    maxTokens: args.plan.maxTokens,
    timeoutMs: 300000,
    screenDeadlineMs: null,
  };
  if (!args.mock && (!cfg.baseUrl || !cfg.apiKey)) {
    throw new Error('set CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_API_KEY');
  }
  process.umask(0o077);
  const results = [];
  let inProgressSeed = null;
  const transport = makePacedRequest({
    reasoningEffort: args.plan.reasoningEffort,
    getSlot: () => inProgressSeed,
  });
  const checkpoint = () =>
    writeOutput(
      args.output,
      {
        summary: summarizeDefenseResults(results, args, cfg),
        config: {
          seeds: args.plan.seeds,
          temperature: 0,
          max_tokens: cfg.maxTokens,
          reasoning_effort: args.plan.reasoningEffort,
          concurrency: 1,
          request_wall_ms: REQUEST_WALL_MS,
          case_wall_ms: args.plan.caseWallMs,
          min_request_start_gap_ms: MIN_REQUEST_GAP_MS,
          retry_delays_ms: RETRY_DELAYS_MS,
          prompt_sha256: hash(DEFENSE_PROMPT),
          evidence_dir: args.evidenceDir ?? 'frozen-default',
        },
        request_starts: transport.starts,
        request_responses: transport.responses,
        in_progress_seed: inProgressSeed,
        results,
      },
      { replaceExisting: true },
    );
  for (const seed of args.plan.seeds) {
    inProgressSeed = seed;
    cfg.screenDeadlineMs = Date.now() + args.plan.caseWallMs;
    checkpoint();
    const result = await runDefenseCase(
      seed,
      {
        mock: args.mock,
        evidenceDir: args.evidenceDir ?? undefined,
      },
      cfg,
      transport.request,
    );
    results.push(result);
    inProgressSeed = null;
    checkpoint();
    process.stdout.write(`defense ${seed}: ${result.classification}\n`);
  }
  process.stdout.write(`${JSON.stringify(summarizeDefenseResults(results, args, cfg))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
