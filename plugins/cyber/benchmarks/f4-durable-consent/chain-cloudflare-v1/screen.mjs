#!/usr/bin/env node
// Versioned Cloudflare model screen over unchanged F4 offense, defense, and stage harnesses.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { modelPrompt as v3Prompt } from '../chain-v3/runner.mjs';
import {
  loadFrozenCases as loadV4Cases,
  runCase as runV4Case,
  modelPrompt as v4Prompt,
} from '../chain-v4/runner.mjs';
import {
  loadFrozenCases as loadV5Cases,
  runCase as runV5Case,
  SYSTEM_PROMPT,
} from '../chain-v5/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const CONCURRENCY = 4;
const CLASSIFICATIONS = ['pass', 'model_fail', 'format_fail', 'provider_error', 'invalid_run'];

export const MODEL_ID = '@cf/zai-org/glm-5.3';
export const ENDPOINT_ID = 'cloudflare-openai-compatible';

export function verifyFrozenBindings() {
  if (
    manifest.model_id !== MODEL_ID ||
    manifest.endpoint_id !== ENDPOINT_ID ||
    sha(v3Prompt('offense')) !== manifest.modes.offense.prompt_sha256 ||
    sha(SYSTEM_PROMPT) !== manifest.modes.defense.prompt_sha256 ||
    sha(v4Prompt('stage')) !== manifest.modes.stage.prompt_sha256
  ) {
    throw new Error('F4 Cloudflare model or prompt binding mismatch');
  }
  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    if (sha(fs.readFileSync(path.join(familyRoot, relativePath))) !== expected) {
      throw new Error(`F4 Cloudflare source binding mismatch: ${relativePath}`);
    }
  }
  return true;
}

export function gridFor(mode) {
  const seeds = manifest.modes[mode]?.seeds;
  if (!seeds || !['offense', 'defense', 'stage'].includes(mode)) {
    throw new Error('invalid F4 Cloudflare mode');
  }
  return seeds.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
}

export function cloudflareConfig(env = process.env) {
  const endpoint = env.CLOUDFLARE_OPENAI_BASE_URL;
  const apiKey = env.CLOUDFLARE_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error(
      'live F4 Cloudflare screen needs CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_API_KEY',
    );
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') {
    throw new Error('Cloudflare OpenAI base URL must use HTTPS');
  }
  return {
    endpoint: endpoint.replace(/\/+$/u, ''),
    apiKey,
    model: MODEL_ID,
    endpointId: ENDPOINT_ID,
  };
}

export function classifyLegacyFailure(spec, exitCode, stderr) {
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

export function summarize(results, mode) {
  const counts = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [
      classification,
      results.filter((result) => result.classification === classification).length,
    ]),
  );
  const valid = results.filter((result) => result.score?.valid_output);
  const sum = (items, key) => items.reduce((total, item) => total + (item.score?.[key] ?? 0), 0);
  const checks =
    mode === 'offense' || mode === 'stage'
      ? Object.fromEntries(
          [...new Set(results.flatMap((result) => Object.keys(result.score?.checks ?? {})))].map(
            (key) => [key, results.filter((result) => result.score?.checks?.[key]).length],
          ),
        )
      : undefined;
  return {
    screen_id: manifest.screen_id,
    mode,
    model: MODEL_ID,
    endpoint_id: ENDPOINT_ID,
    prompt_sha256: manifest.modes[mode].prompt_sha256,
    planned: gridFor(mode).length,
    attempted: results.length,
    screen_complete: results.length === gridFor(mode).length,
    ...counts,
    exact: counts.pass,
    valid_attempts: results.filter(
      (result) => !['provider_error', 'invalid_run'].includes(result.classification),
    ).length,
    parseable_attempts: results.filter(
      (result) => !['provider_error', 'invalid_run', 'format_fail'].includes(result.classification),
    ).length,
    ...(checks ? { stage_survival: checks } : {}),
    ...(mode === 'defense'
      ? {
          valid_output_batches: valid.length,
          tp: sum(valid, 'tp'),
          fp: sum(valid, 'fp'),
          fn: sum(valid, 'fn'),
          fp_on_survivor: sum(valid, 'fp_on_survivor'),
          fp_on_approved: sum(valid, 'fp_on_approved'),
        }
      : {}),
  };
}

async function runLegacyOffense(spec, options) {
  const output = path.join(options.tempDir, `offense-${spec.seed}-${spec.family}.json`);
  const args = [
    path.join(familyRoot, 'chain-v3/runner.mjs'),
    '--mode',
    'offense',
    '--seeds',
    String(spec.seed),
    '--families',
    spec.family,
    '--output',
    output,
  ];
  if (options.mockReference) {
    args.push('--mock-reference');
  }
  const env = {
    ...process.env,
    ...(options.config
      ? {
          CYBER_SUT_ENDPOINT: options.config.endpoint,
          CYBER_API_KEY: options.config.apiKey,
          CYBER_MODEL: MODEL_ID,
          CYBER_ENDPOINT_ID: ENDPOINT_ID,
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
  if (mode === 'defense') {
    return await runV5Case(spec, {
      mockReference: options.mockReference,
      config: options.config,
      frozenCases: options.frozenCases,
      request: options.request,
    });
  }
  return await runV4Case(spec, 'stage', {
    mockReference: options.mockReference,
    config: options.config,
    frozenCases: options.frozenCases,
    request: options.request,
  });
}

function shouldHalt(result, index) {
  return (
    result.classification === 'invalid_run' ||
    (result.classification === 'provider_error' && index === 0)
  );
}

export async function runScreen(options = {}) {
  const mode = options.mode ?? 'offense';
  const grid = gridFor(mode);
  verifyFrozenBindings();
  const mockReference = options.mockReference === true;
  const output = options.output;
  if (!mockReference && !output) {
    throw new Error('live F4 Cloudflare screen needs --output');
  }
  if (output && path.resolve(output).startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error('raw screen output must be outside the repository');
  }
  const config = mockReference ? null : cloudflareConfig(options.env);
  const frozenCases = mode === 'defense' ? loadV5Cases() : mode === 'stage' ? loadV4Cases() : null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-cf53-v1-'));
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
      request: options.request,
    });
    slots[index] = result;
    process.stdout.write(
      `${mode} ${spec.seed}/${spec.family}: ${result.classification}${result.reason ? ` (${result.reason})` : ''}\n`,
    );
    persist();
    if (shouldHalt(result, index)) {
      halted = true;
    }
  };
  try {
    // One scored case validates authentication and model echo before concurrent calls.
    await execute(0);
    if (!halted) {
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (!halted && nextIndex < grid.length) {
          const index = nextIndex++;
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
    const option = argv[index];
    if (option === '--mode') {
      args.mode = argv[++index];
    } else if (option === '--mock-reference') {
      args.mockReference = true;
    } else if (option === '--output') {
      args.output = argv[++index];
    } else {
      throw new Error(`unknown option ${option}`);
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
