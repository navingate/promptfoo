#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { FAMILIES } from './estate.mjs';
import { callModel, DEFAULTS, PROMPTS, runScreen } from './runner.mjs';

export const SCREEN_VERSION = 'f9-v8-cloudflare-glm53-v1-low16';
export const EXACT_MODEL = '@cf/zai-org/glm-5.3';
export const DIAGNOSTIC_MAX_TOKENS = 16384;
export const SUBTYPES = Object.freeze(['malicious', 'breakglass', 'planned', 'false-positive']);
export const MIN_REQUEST_INTERVAL_MS = 5000;
export const OFFENSE_SEEDS = Object.freeze(Array.from({ length: 12 }, (_, i) => 24001 + i));
export const DEFENSE_SEEDS = Object.freeze(OFFENSE_SEEDS.slice(0, 3));
export const PILOT_SEED = 23901;

export function screenSettings(env = process.env) {
  const baseUrl = env.CLOUDFLARE_OPENAI_BASE_URL;
  const apiKey = env.CLOUDFLARE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_API_KEY are required');
  }
  if (new URL(baseUrl).protocol !== 'https:') {
    throw new Error('Cloudflare endpoint must use HTTPS');
  }
  return {
    baseUrl,
    apiKey,
    model: EXACT_MODEL,
    endpointId: 'cloudflare-workers-ai-openai-compat',
    maxTokens: DEFAULTS.maxTokens,
    timeoutMs: DEFAULTS.timeoutMs,
  };
}

export function withLowReasoning(fetchImpl) {
  return (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model !== EXACT_MODEL) {
      throw new Error('model ID drift');
    }
    return fetchImpl(url, {
      ...options,
      body: JSON.stringify({ ...body, reasoning_effort: 'low' }),
    });
  };
}

export function createPacedFetch(
  fetchImpl,
  {
    minIntervalMs = MIN_REQUEST_INTERVAL_MS,
    timeoutMs = 300000,
    now = () => performance.now(),
    sleep = delay,
  } = {},
) {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error('invalid request interval');
  }
  let lastStartedAt = -Infinity;
  return async (url, options) => {
    let waitMs = Math.max(0, lastStartedAt + minIntervalMs - now());
    while (waitMs > 0) {
      await sleep(waitMs);
      waitMs = Math.max(0, lastStartedAt + minIntervalMs - now());
    }
    lastStartedAt = now();
    return fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  };
}

function casesFor(mode) {
  if (mode === 'pilot-offense') {
    return [{ seed: PILOT_SEED, family: 'cached-interval' }];
  }
  if (mode === 'offense' || mode === 'grant-stage') {
    return OFFENSE_SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
  }
  if (mode === 'defense') {
    return DEFENSE_SEEDS.flatMap((seed) =>
      FAMILIES.flatMap((family) => SUBTYPES.map((subtype) => ({ seed, family, subtype }))),
    );
  }
  throw new Error('mode must be pilot-offense, offense, defense, or grant-stage');
}

function summaryFor(runMode, cases, results) {
  const valid = results.filter((result) => result.valid_output);
  return {
    mode: runMode,
    model: EXACT_MODEL,
    endpoint_id: 'cloudflare-workers-ai-openai-compat',
    prompt_sha256: crypto.createHash('sha256').update(PROMPTS[runMode]).digest('hex'),
    assigned_cases: cases.length,
    attempted_cases: results.length,
    pass: results.filter((result) => result.classification === 'pass').length,
    valid_output_runs: valid.length,
    conditional_pass: valid.filter((result) => result.classification === 'pass').length,
    model_fail: results.filter((result) => result.classification === 'model_fail').length,
    provider_error: results.filter((result) => result.classification === 'provider_error').length,
    invalid_run: results.filter((result) => result.classification === 'invalid_run').length,
    truncated: results.filter((result) => result.reason === 'truncated').length,
    off_grammar: results.filter((result) => result.reason === 'off-grammar').length,
  };
}

function saveCheckpoint(output, report) {
  const temp = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temp, output);
}

export async function runPacedScreen(mode, cfg, output, { pacedFetch = null } = {}) {
  const cases = casesFor(mode);
  if (!output.startsWith('/tmp/') || !output.endsWith('.json')) {
    throw new Error('raw output must be an absolute /tmp/*.json path');
  }
  const fd = fs.openSync(output, 'wx', 0o600);
  fs.closeSync(fd);
  const runMode = mode === 'pilot-offense' ? 'offense' : mode;
  const results = [];
  const report = {
    screen_version: SCREEN_VERSION,
    implementation_version: 'f9-v8-candidate-1',
    transport_min_interval_ms: MIN_REQUEST_INTERVAL_MS,
    reasoning_effort: 'low',
    max_tokens: DIAGNOSTIC_MAX_TOKENS,
    status: 'prepared',
    preflight: null,
    summary: summaryFor(runMode, cases, results),
    results,
  };
  saveCheckpoint(output, report);
  const fetchImpl =
    pacedFetch ??
    createPacedFetch(cfg.fetchImpl ?? globalThis.fetch, {
      timeoutMs: cfg.timeoutMs,
    });
  const liveCfg = {
    ...cfg,
    maxTokens: DIAGNOSTIC_MAX_TOKENS,
    fetchImpl: withLowReasoning(fetchImpl),
  };
  const preflight = await callModel([{ role: 'user', content: 'Return PONG.' }], {
    ...liveCfg,
    maxTokens: 16,
  });
  report.preflight =
    preflight.kind === 'ok'
      ? { kind: 'ok', served_model: preflight.served_model }
      : { kind: preflight.kind, reason: preflight.reason };
  if (preflight.kind !== 'ok') {
    report.status = 'preflight-failed';
    saveCheckpoint(output, report);
    return report;
  }
  report.status = 'running';
  saveCheckpoint(output, report);
  for (const spec of cases) {
    const single = await runScreen({
      mode: runMode,
      seeds: [spec.seed],
      families: [spec.family],
      subtypes: spec.subtype ? [spec.subtype] : undefined,
      cfg: liveCfg,
    });
    if (single.results.length !== 1) {
      throw new Error('one-case runner result drift');
    }
    const result = single.results[0];
    results.push(result);
    report.summary = summaryFor(runMode, cases, results);
    if (result.classification === 'provider_error') {
      report.status = result.reason === 'http-429' ? 'halted-rate-limit' : 'halted-provider';
    } else if (result.classification === 'invalid_run') {
      report.status = 'halted-invalid';
    }
    saveCheckpoint(output, report);
    if (report.status !== 'running') {
      return report;
    }
  }
  report.status = 'complete';
  saveCheckpoint(output, report);
  return report;
}

async function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--mode' || argv[2] !== '--output') {
    throw new Error(
      'usage: cloudflare-glm53-v8-screen.mjs --mode <pilot-offense|offense|defense|grant-stage> --output /tmp/file.json',
    );
  }
  const [, mode, , output] = argv;
  const report = await runPacedScreen(mode, screenSettings(), output);
  process.stdout.write(
    `${JSON.stringify({
      screen_version: report.screen_version,
      status: report.status,
      preflight: report.preflight,
      ...report.summary,
    })}\n`,
  );
  process.stdout.write(`raw_capture=${output}\n`);
  if (report.status !== 'complete') {
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
