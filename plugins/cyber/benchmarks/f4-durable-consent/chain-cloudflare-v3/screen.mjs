#!/usr/bin/env node
// Fresh F4 Cloudflare low-reasoning score; all security semantics come from frozen F4 harnesses.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  summarize as baseSummary,
  cloudflareConfig,
  verifyFrozenBindings,
} from '../chain-cloudflare-v1/screen.mjs';
import { rewriteRequestBody } from '../chain-cloudflare-v2/transport-preload.mjs';
import { CAPTURE_SEEDS } from '../chain-v4/generate-captures.mjs';
import { loadFrozenCases as loadV4Cases, runCase as runV4Case } from '../chain-v4/runner.mjs';
import { SEEDS as DEFENSE_SEEDS } from '../chain-v5/generate-captures.mjs';
import { loadFrozenCases as loadV5Cases, runCase as runV5Case } from '../chain-v5/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { pacedRequest, REQUEST_GAP_MS } from './pace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const CONCURRENCY = 1;
const MAX_TOKENS = 16384;
const REASONING_EFFORT = 'low';

export function verifyBindings() {
  verifyFrozenBindings();
  if (
    manifest.screen_id !== 'f4-cloudflare-glm53-low16-v3' ||
    manifest.max_tokens !== MAX_TOKENS ||
    manifest.reasoning_effort !== REASONING_EFFORT ||
    manifest.concurrent_cases_after_first !== CONCURRENCY ||
    manifest.minimum_request_start_gap_ms !== REQUEST_GAP_MS ||
    JSON.stringify(manifest.defense_seeds) !== JSON.stringify(DEFENSE_SEEDS) ||
    JSON.stringify(manifest.stage_seeds) !== JSON.stringify(CAPTURE_SEEDS)
  ) {
    throw new Error('F4 low-reasoning protocol mismatch');
  }
  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    if (sha(fs.readFileSync(path.join(familyRoot, relativePath))) !== expected) {
      throw new Error(`F4 low-reasoning source binding mismatch: ${relativePath}`);
    }
  }
  return true;
}

export function gridFor(mode) {
  const seeds =
    mode === 'offense'
      ? manifest.offense_seeds
      : mode === 'defense'
        ? DEFENSE_SEEDS
        : mode === 'stage'
          ? CAPTURE_SEEDS
          : null;
  if (!seeds) {
    throw new Error('invalid F4 low-reasoning mode');
  }
  return seeds.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
}

// biome-ignore lint/style/noRestrictedGlobals: standalone benchmark request adapter, with injected request in tests
export function transportRequest(request = fetch) {
  return async (url, init) => {
    const body = rewriteRequestBody(JSON.parse(init.body), MAX_TOKENS, REASONING_EFFORT);
    return await request(url, { ...init, body: JSON.stringify(body) });
  };
}

function classifyLegacyFailure(spec, exitCode, stderr) {
  const auth = stderr.match(/gateway authentication failed \((401|403)\)/u);
  return {
    spec,
    classification: 'invalid_run',
    reason: auth ? `gateway-auth-${auth[1]}` : `legacy-runner-exit-${exitCode}`,
    score: null,
    turns: 0,
    actions: 0,
  };
}

async function runLegacyOffense(spec, options) {
  const output = path.join(options.tempDir, `offense-${spec.seed}-${spec.family}.json`);
  const args = [
    ...(options.config ? [`--import=${path.join(here, 'offense-preload.mjs')}`] : []),
    path.join(familyRoot, 'chain-v3/runner.mjs'),
    '--mode',
    'offense',
    '--seeds',
    String(spec.seed),
    '--families',
    spec.family,
    '--output',
    output,
    ...(options.mockReference ? ['--mock-reference'] : []),
  ];
  const env = {
    ...process.env,
    ...(options.config
      ? {
          CYBER_SUT_ENDPOINT: options.config.endpoint,
          CYBER_API_KEY: options.config.apiKey,
          CYBER_MODEL: options.config.model,
          CYBER_ENDPOINT_ID: options.config.endpointId,
          F4_CF_SCORE_PRELOAD: '1',
        }
      : {}),
  };
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      try {
        if (exitCode !== 0) {
          resolve(classifyLegacyFailure(spec, exitCode, stderr));
          return;
        }
        const result = JSON.parse(fs.readFileSync(output, 'utf8')).results?.[0];
        if (!result || result.spec?.seed !== spec.seed || result.spec?.family !== spec.family) {
          throw new Error('legacy offense output mismatch');
        }
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        fs.rmSync(output, { force: true });
      }
    });
  });
}

async function runOne(spec, mode, options) {
  if (mode === 'offense') {
    return await runLegacyOffense(spec, options);
  }
  const request = options.request;
  if (mode === 'defense') {
    return await runV5Case(spec, {
      mockReference: options.mockReference,
      config: options.config,
      frozenCases: options.frozenCases,
      request,
    });
  }
  return await runV4Case(spec, 'stage', {
    mockReference: options.mockReference,
    config: options.config,
    frozenCases: options.frozenCases,
    request,
  });
}

function summarize(results, mode) {
  return {
    ...baseSummary(results, mode),
    screen_id: manifest.screen_id,
    max_tokens: MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
    planned: gridFor(mode).length,
  };
}

export async function runScreen(options = {}) {
  const mode = options.mode ?? 'offense';
  const grid = gridFor(mode);
  verifyBindings();
  const mockReference = options.mockReference === true;
  const output = options.output;
  if (!mockReference && !output) {
    throw new Error('live F4 low-reasoning screen needs --output');
  }
  if (output && path.resolve(output).startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error('raw screen output must be outside the repository');
  }
  const config = mockReference ? null : cloudflareConfig(options.env);
  const frozenCases = mode === 'defense' ? loadV5Cases() : mode === 'stage' ? loadV4Cases() : null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-cf53-v3-'));
  const request = mockReference ? undefined : pacedRequest(transportRequest(options.request));
  const slots = Array(grid.length);
  let nextIndex = 1;
  let halted = false;
  const persist = () => {
    if (!output) {
      return;
    }
    const completed = slots.filter(Boolean);
    fs.writeFileSync(
      output,
      `${JSON.stringify(
        {
          summary: summarize(completed, mode),
          manifest_sha256: sha(fs.readFileSync(path.join(here, 'manifest.json'))),
          results: completed,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  };
  const execute = async (index) => {
    const spec = grid[index];
    const result = await runOne(spec, mode, {
      mockReference,
      config,
      frozenCases,
      tempDir,
      request,
    });
    slots[index] = result;
    process.stdout.write(
      `${mode} ${spec.seed}/${spec.family}: ${result.classification}${result.reason ? ` (${result.reason})` : ''}\n`,
    );
    persist();
    if (['invalid_run', 'provider_error'].includes(result.classification)) {
      halted = true;
    }
  };
  try {
    await execute(0);
    if (!halted) {
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (!halted && nextIndex < grid.length) {
          const index = nextIndex++;
          if (!mockReference && mode === 'offense') {
            await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
          }
          await execute(index);
        }
      });
      await Promise.all(workers);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const completed = slots.filter(Boolean);
  const summary = summarize(completed, mode);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return { summary, results: completed };
}

function parseArgs(argv) {
  const args = { mode: 'offense', mockReference: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mode') {
      args.mode = argv[++index];
    } else if (argv[index] === '--mock-reference') {
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
