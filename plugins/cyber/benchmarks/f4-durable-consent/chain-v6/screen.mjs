#!/usr/bin/env node
// Pre-registered F4 v6 Cloudflare defense candidate; no implicit model calls.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareConfig } from '../chain-cloudflare-v1/screen.mjs';
import { rewriteRequestBody } from '../chain-cloudflare-v2/transport-preload.mjs';
import { pacedRequest, REQUEST_GAP_MS } from '../chain-cloudflare-v3/pace.mjs';
import { referenceLabels } from '../chain-v4/capture.mjs';
import { runCase as runV5Case, SYSTEM_PROMPT } from '../chain-v5/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { LABEL_PATH, MANIFEST_PATH, NATIVE_PATH, SEEDS } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const MODEL = '@cf/zai-org/glm-5.3';
const MAX_TOKENS = 16384;
const REASONING_EFFORT = 'low';
const SOURCE_PATHS = [
  'chain-cloudflare-v1/screen.mjs',
  'chain-cloudflare-v2/transport-preload.mjs',
  'chain-cloudflare-v3/pace.mjs',
  'chain-v3/offense.mjs',
  'chain-v3/runner.mjs',
  'chain-v4/capture.mjs',
  'chain-v4/producer.mjs',
  'chain-v4/runner.mjs',
  'chain-v5/runner.mjs',
  'chain-v6/generate-captures.mjs',
  'chain-v6/producer.mjs',
  'chain-v6/screen.mjs',
  'shared/estate.mjs',
];

export function gridFor() {
  return SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
}

export function verifyBindings() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (
    manifest.candidate_id !== 'f4-defense-native-v6-glm53' ||
    manifest.model !== MODEL ||
    manifest.max_tokens !== MAX_TOKENS ||
    manifest.reasoning_effort !== REASONING_EFFORT ||
    manifest.minimum_request_start_gap_ms !== REQUEST_GAP_MS ||
    manifest.status !== 'offline-candidate-no-model-calls' ||
    JSON.stringify(manifest.seeds) !== JSON.stringify(SEEDS) ||
    JSON.stringify(manifest.families) !== JSON.stringify(FAMILIES) ||
    manifest.order !== 'seed-then-family' ||
    manifest.batches !== 36 ||
    manifest.records !== 468 ||
    manifest.capture_sha256 !== sha(fs.readFileSync(NATIVE_PATH)) ||
    manifest.labels_sha256 !== sha(fs.readFileSync(LABEL_PATH)) ||
    manifest.prompt_sha256 !== sha(SYSTEM_PROMPT) ||
    JSON.stringify(Object.keys(manifest.source_sha256).sort()) !==
      JSON.stringify([...SOURCE_PATHS].sort())
  ) {
    throw new Error('F4 v6 candidate binding mismatch');
  }
  for (const name of SOURCE_PATHS) {
    if (manifest.source_sha256[name] !== sha(fs.readFileSync(path.join(familyRoot, name)))) {
      throw new Error(`F4 v6 source binding mismatch: ${name}`);
    }
  }
  return true;
}

export function loadCases() {
  verifyBindings();
  const native = fs.readFileSync(NATIVE_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  const keys = fs.readFileSync(LABEL_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  if (native.length !== 36 || keys.length !== 36) {
    throw new Error('incomplete F4 v6 grid');
  }
  const cases = new Map();
  for (let index = 0; index < native.length; index += 1) {
    const spec = gridFor()[index];
    const batch = native[index];
    const key = keys[index];
    if (
      batch.seed !== spec.seed ||
      batch.family !== spec.family ||
      key.seed !== spec.seed ||
      key.family !== spec.family ||
      JSON.stringify(referenceLabels(batch)) !== JSON.stringify(key.labels)
    ) {
      throw new Error('F4 v6 native/key mismatch');
    }
    cases.set(`${spec.seed}/${spec.family}`, { batch, labels: key.labels });
  }
  return cases;
}

// biome-ignore lint/style/noRestrictedGlobals: standalone benchmark request adapter, with injected request in tests
export function transportRequest(request = fetch) {
  return async (url, init) => {
    const body = rewriteRequestBody(JSON.parse(init.body), MAX_TOKENS, REASONING_EFFORT);
    return await request(url, { ...init, body: JSON.stringify(body) });
  };
}

function summarize(results, mockReference) {
  const metrics = (items) => {
    const counts = Object.fromEntries(
      ['pass', 'model_fail', 'format_fail', 'provider_error', 'invalid_run'].map((kind) => [
        kind,
        items.filter((result) => result.classification === kind).length,
      ]),
    );
    const valid = items.filter((result) => result.score?.valid_output);
    const sum = (key) => valid.reduce((total, result) => total + (result.score[key] ?? 0), 0);
    const tp = sum('tp');
    const fp = sum('fp');
    const fn = sum('fn');
    return {
      attempted: items.length,
      ...counts,
      exact: counts.pass,
      valid_output_batches: valid.length,
      tp,
      fp,
      fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      fp_on_survivor: sum('fp_on_survivor'),
      fp_on_approved: sum('fp_on_approved'),
    };
  };
  const totals = metrics(results);
  return {
    candidate_id: 'f4-defense-native-v6-glm53',
    mode: 'defense',
    model: mockReference ? 'reference' : MODEL,
    endpoint_id: mockReference ? 'local' : 'cloudflare-openai-compatible',
    prompt_sha256: sha(SYSTEM_PROMPT),
    planned: 36,
    screen_complete: results.length === 36,
    ...totals,
    valid_attempts: results.length - totals.provider_error - totals.invalid_run,
    parseable_attempts: totals.valid_output_batches,
    families: Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        metrics(results.filter((result) => result.spec.family === family)),
      ]),
    ),
    max_tokens: MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
  };
}

export async function runScreen(options = {}) {
  const cases = loadCases();
  const mockReference = options.mockReference === true;
  if (!mockReference && !options.output) {
    throw new Error('live F4 v6 screen needs an output path');
  }
  if (options.output && path.resolve(options.output).startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error('raw output must be outside the repository');
  }
  const config = mockReference ? null : cloudflareConfig(options.env);
  const request = mockReference ? undefined : pacedRequest(transportRequest(options.request));
  const results = [];
  for (const spec of gridFor()) {
    const captured = cases.get(`${spec.seed}/${spec.family}`);
    const legacySpec = { seed: spec.seed - 2000, family: spec.family };
    const legacyCases = new Map([[`${legacySpec.seed}/${legacySpec.family}`, captured]]);
    const result = await runV5Case(legacySpec, {
      mockReference,
      config,
      frozenCases: legacyCases,
      request,
    });
    results.push({ ...result, spec });
    if (!options.quiet) {
      process.stdout.write(`defense ${spec.seed}/${spec.family}: ${result.classification}\n`);
    }
    if (options.output) {
      fs.writeFileSync(
        options.output,
        `${JSON.stringify(
          {
            summary: summarize(results, mockReference),
            manifest_sha256: sha(fs.readFileSync(MANIFEST_PATH)),
            results,
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    }
    if (['provider_error', 'invalid_run'].includes(result.classification)) {
      break;
    }
  }
  const summary = summarize(results, mockReference);
  if (!options.quiet) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }
  return { summary, results };
}

function parseArgs(argv) {
  const args = { mockReference: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mock-reference') {
      args.mockReference = true;
    } else if (argv[index] === '--output') {
      args.output = argv[++index];
    } else {
      throw new Error(`unknown option ${argv[index]}`);
    }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScreen(parseArgs(process.argv.slice(2)))
    .then(({ summary }) => {
      if (!summary.screen_complete || summary.invalid_run || summary.provider_error) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
