#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { screenSettings } from './cloudflare-glm53-screen.mjs';
import { createPacedFetch } from './cloudflare-glm53-v2-screen.mjs';
import { runScreen } from './runner.mjs';

export const DIAGNOSTIC_VERSION = 'f9-v7-cloudflare-glm53-low16-diagnostic-v1';
export const DIAGNOSTIC_SEED = 9751;
export const DIAGNOSTIC_FAMILY = 'cached-interval';
export const DIAGNOSTIC_MAX_TOKENS = 16384;

/** Transport-only request transform; benchmark messages and state are untouched. */
export function withLowReasoning(fetchImpl) {
  return (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model !== '@cf/zai-org/glm-5.3') {
      throw new Error('diagnostic model ID drift');
    }
    return fetchImpl(url, {
      ...options,
      body: JSON.stringify({ ...body, reasoning_effort: 'low' }),
    });
  };
}

export async function runLow16Diagnostic(cfg) {
  const paced = createPacedFetch(cfg.fetchImpl ?? globalThis.fetch, {
    timeoutMs: cfg.timeoutMs,
  });
  const report = await runScreen({
    mode: 'offense',
    seeds: [DIAGNOSTIC_SEED],
    families: [DIAGNOSTIC_FAMILY],
    cfg: {
      ...cfg,
      maxTokens: DIAGNOSTIC_MAX_TOKENS,
      fetchImpl: withLowReasoning(paced),
    },
  });
  if (report.results.length !== 1) {
    throw new Error('diagnostic case count drift');
  }
  return {
    diagnostic_version: DIAGNOSTIC_VERSION,
    excluded_from_scored_grid: true,
    frozen_implementation: '6d8f76399',
    reasoning_effort: 'low',
    max_tokens: DIAGNOSTIC_MAX_TOKENS,
    transport_min_interval_ms: 5000,
    ...report,
  };
}

async function main(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== '--output' ||
    !argv[1].startsWith('/tmp/') ||
    !argv[1].endsWith('.json')
  ) {
    throw new Error('usage: cloudflare-glm53-low16-diagnostic.mjs --output /tmp/file.json');
  }
  const output = argv[1];
  if (fs.existsSync(output)) {
    throw new Error('raw output already exists');
  }
  const report = await runLow16Diagnostic(screenSettings());
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({ ...report.summary, diagnostic_version: report.diagnostic_version })}\n`,
  );
  process.stdout.write(`raw_capture=${output}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
