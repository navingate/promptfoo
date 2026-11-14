#!/usr/bin/env node
// Versioned Cloudflare orchestration: frozen F10 task functions plus paced request starts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUEST_WALL_MS, RETRY_DELAYS_MS } from '../v5/transport.mjs';
import { ENDPOINT_ID, MODEL, verifyEndpointBinding } from '../v7/cloudflare-screen.mjs';
import { MIN_REQUEST_GAP_MS, makePacedRequest } from '../v8/paced-transport.mjs';
import { OFFENSE_PROMPT } from './chain.mjs';
import { DEFENSE_PROMPT } from './defense.mjs';
import { assertSafeOutputPath, runDefenseCase, writeOutput } from './defense-runner.mjs';
import { runOffense } from './runner.mjs';

export const OFFENSE_SEEDS = Array.from({ length: 36 }, (_, index) => 21001 + index);
export const DEFENSE_SEEDS = Array.from({ length: 12 }, (_, index) => 13001 + index);
export const OFFENSE_CASE_WALL_MS = 900000;
export const DEFENSE_CASE_WALL_MS = 600000;

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function planForMode(mode) {
  if (mode === 'offense') {
    return {
      seeds: OFFENSE_SEEDS,
      task: 'offense',
      maxTokens: 16384,
      reasoningEffort: 'low',
      maxTurns: 80,
      caseWallMs: OFFENSE_CASE_WALL_MS,
    };
  }
  if (mode === 'defense') {
    return {
      seeds: DEFENSE_SEEDS,
      task: 'defense',
      maxTokens: 16384,
      reasoningEffort: 'low',
      maxTurns: null,
      caseWallMs: DEFENSE_CASE_WALL_MS,
    };
  }
  throw new Error('mode must be offense or defense');
}

export function parseArgs(argv) {
  const args = { mode: null, output: null, mock: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mode') {
      args.mode = argv[++index];
    } else if (flag === '--output') {
      args.output = argv[++index];
    } else if (flag === '--mock-reference') {
      args.mock = true;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  const plan = planForMode(args.mode);
  const label = args.mock ? 'reference' : 'glm53';
  args.output ??= `/tmp/f10-v13-cf-${label}-${args.mode}.json`;
  args.output = assertSafeOutputPath(args.output);
  if (fs.existsSync(args.output)) {
    throw new Error('output already exists; retain the first capture and choose a new path');
  }
  return { ...args, plan };
}

function summarize(results, args, cfg) {
  const requests = results.flatMap((result) => [
    ...(result.transcript ?? []).map((turn) => turn.transport).filter(Boolean),
    ...(result.transport ? [result.transport] : []),
  ]);
  return {
    mode: args.mode,
    task: args.plan.task,
    model: args.mock ? 'reference' : cfg.model,
    endpoint_id: args.mock ? 'local-reference' : cfg.endpointId,
    completed_slots: results.length,
    planned_slots: args.plan.seeds.length,
    pass: results.filter((result) => result.classification === 'pass').length,
    model_fail: results.filter((result) => result.classification === 'model_fail').length,
    provider_error: results.filter((result) => result.classification === 'provider_error').length,
    invalid_run: results.filter((result) => result.classification === 'invalid_run').length,
    off_grammar: results.filter((result) => result.reason === 'off-grammar').length,
    valid_decisions: results.filter(
      (result) =>
        ['pass', 'model_fail'].includes(result.classification) && result.reason !== 'off-grammar',
    ).length,
    parsed_defense_batches: results.filter((result) => result.parsed === true).length,
    transport_retried_requests: requests.filter((request) => request.attempts > 1).length,
    transient_error_events: requests.reduce(
      (sum, request) => sum + request.transient_errors.length,
      0,
    ),
  };
}

function capture(results, args, cfg, starts, responses, inProgressSeed) {
  return {
    summary: summarize(results, args, cfg),
    config: {
      seeds: args.plan.seeds,
      family: args.plan.task === 'offense' ? 'multi-identity-fanout' : undefined,
      model: cfg.model,
      endpoint_id: cfg.endpointId,
      temperature: 0,
      max_tokens: cfg.maxTokens,
      reasoning_effort: args.plan.reasoningEffort,
      max_turns: args.plan.maxTurns,
      concurrency: 1,
      request_timeout_ms: cfg.timeoutMs,
      request_wall_ms: REQUEST_WALL_MS,
      case_wall_ms: args.plan.caseWallMs,
      total_case_wall_budget_ms: args.plan.caseWallMs * args.plan.seeds.length,
      deadline_policy: 'fresh-per-case',
      min_request_start_gap_ms: MIN_REQUEST_GAP_MS,
      retry_delays_ms: RETRY_DELAYS_MS,
      prompt_sha256: hash(args.plan.task === 'offense' ? OFFENSE_PROMPT : DEFENSE_PROMPT),
    },
    request_starts: starts,
    request_responses: responses,
    in_progress_seed: inProgressSeed,
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mock) {
    verifyEndpointBinding(process.env);
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
  const checkpoint = () =>
    writeOutput(
      args.output,
      capture(results, args, cfg, transport.starts, transport.responses, inProgressSeed),
    );
  const transport = makePacedRequest({
    reasoningEffort: args.plan.reasoningEffort,
    getSlot: () => inProgressSeed,
  });
  process.stdout.write(
    `F10 v13 ${args.mode}: ${args.plan.seeds.length} fixed slots, ${args.mock ? 'reference' : MODEL}, 5000 ms attempt gap\n`,
  );
  for (const seed of args.plan.seeds) {
    inProgressSeed = seed;
    cfg.screenDeadlineMs = Date.now() + args.plan.caseWallMs;
    checkpoint();
    let result;
    if (args.plan.task === 'offense') {
      result = await runOffense(
        { seed, family: 'multi-identity-fanout' },
        { mock: args.mock, maxTurns: args.plan.maxTurns },
        cfg,
        transport.request,
      );
    } else {
      result = await runDefenseCase(seed, { mock: args.mock }, cfg, transport.request);
    }
    results.push(result);
    inProgressSeed = null;
    checkpoint();
    process.stdout.write(
      `${args.mode} ${seed}: ${result.classification}${result.reason ? ` (${result.reason})` : ''}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(summarize(results, args, cfg))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
