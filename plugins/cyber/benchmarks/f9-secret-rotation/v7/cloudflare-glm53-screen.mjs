#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { FAMILIES } from './estate.mjs';
import { callModel, DEFAULTS, runScreen } from './runner.mjs';

export const SCREEN_VERSION = 'f9-v7-cloudflare-glm53-v1';
export const EXACT_MODEL = '@cf/zai-org/glm-5.3';
export const OFFENSE_SEEDS = Object.freeze(Array.from({ length: 12 }, (_, i) => 18001 + i));
export const DEFENSE_SEEDS = Object.freeze(OFFENSE_SEEDS.slice(0, 3));
export const SUBTYPES = Object.freeze(['malicious', 'breakglass', 'planned', 'false-positive']);

export function screenSettings(env = process.env) {
  const baseUrl = env.CLOUDFLARE_OPENAI_BASE_URL;
  const apiKey = env.CLOUDFLARE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_API_KEY are required');
  }
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') {
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

/** One non-scored request prevents a stale token from consuming scored seeds. */
export async function preflightCloudflare(cfg) {
  const result = await callModel([{ role: 'user', content: 'Return PONG.' }], {
    ...cfg,
    maxTokens: 16,
  });
  if (result.kind !== 'ok') {
    throw new Error(
      `Cloudflare preflight ${result.kind}: ${result.reason}; no scored cases started`,
    );
  }
  return { served_model: result.served_model };
}

export async function runCloudflareScreen(mode, cfg) {
  if (!['offense', 'grant-stage', 'defense'].includes(mode)) {
    throw new Error('mode must be offense, grant-stage, or defense');
  }
  const report = await runScreen({
    mode,
    seeds: mode === 'defense' ? DEFENSE_SEEDS : OFFENSE_SEEDS,
    families: FAMILIES,
    subtypes: SUBTYPES,
    cfg,
  });
  if (report.summary.total !== 36 || report.results.length !== 36) {
    throw new Error('Cloudflare screen case count drift');
  }
  return {
    screen_version: SCREEN_VERSION,
    frozen_implementation: '6d8f76399',
    ...report,
    provider_auth_errors: report.results.filter(
      (result) =>
        result.classification === 'invalid_run' && ['http-401', 'http-403'].includes(result.reason),
    ).length,
  };
}

async function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--mode' || argv[2] !== '--output') {
    throw new Error(
      'usage: cloudflare-glm53-screen.mjs --mode <offense|grant-stage|defense> --output /tmp/file.json',
    );
  }
  const [, mode, , output] = argv;
  if (!['offense', 'grant-stage', 'defense'].includes(mode)) {
    throw new Error('mode must be offense, grant-stage, or defense');
  }
  if (!output.startsWith('/tmp/') || !output.endsWith('.json')) {
    throw new Error('raw output must be an absolute /tmp/*.json path');
  }
  if (fs.existsSync(output)) {
    throw new Error('raw output already exists; no scored cases started');
  }
  const cfg = screenSettings();
  await preflightCloudflare(cfg);
  const report = await runCloudflareScreen(mode, cfg);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({
      ...report.summary,
      screen_version: report.screen_version,
      provider_auth_errors: report.provider_auth_errors,
    })}\n`,
  );
  process.stdout.write(`raw_capture=${output}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
