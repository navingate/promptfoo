#!/usr/bin/env node
// Cloudflare-only launcher for frozen F10 runners. No model/estate/scorer changes.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSafeOutputPath } from '../v6/defense-runner.mjs';

export const MODEL = '@cf/zai-org/glm-5.3';
export const ENDPOINT_ID = 'cloudflare-workers-ai';
export const BASE_URL_SHA256 = '45dcdd6cc04d8d3870d64536213ea33646a0f49aa4d7d6e35a694dfe2c280d40';
export const OFFENSE_SEEDS = Array.from({ length: 36 }, (_, index) => 15001 + index);
export const DEFENSE_SEEDS = Array.from({ length: 12 }, (_, index) => 12001 + index);
export const PILOT_SEED = 9909;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const scripts = {
  offense: path.resolve(here, '../v5/runner.mjs'),
  defense: path.resolve(here, '../v6/defense-runner.mjs'),
};

export function parseArgs(argv) {
  const args = { mode: null, mock: false, resume: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mode') {
      args.mode = argv[++index];
    } else if (flag === '--output') {
      args.output = argv[++index];
    } else if (flag === '--mock-reference') {
      args.mock = true;
    } else if (flag === '--resume') {
      args.resume = true;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!['pilot-offense', 'offense', 'defense'].includes(args.mode)) {
    throw new Error('mode must be pilot-offense, offense, or defense');
  }
  if (args.resume && args.mode !== 'defense') {
    throw new Error('only defense can resume a native checkpoint');
  }
  const label = args.mock ? 'reference' : 'glm53';
  args.output ??= `/tmp/f10-v7-cf-${label}-${args.mode}.json`;
  const output = assertSafeOutputPath(args.output);
  if (fs.existsSync(output) && !args.resume) {
    throw new Error('output already exists; retain the first capture and choose a new path');
  }
  if (!fs.existsSync(output) && args.resume) {
    throw new Error('defense resume requires an existing checkpoint');
  }
  args.output = output;
  return args;
}

export function cloudflareChildEnv(env, mock = false) {
  const child = { ...env };
  delete child.OPENAI_API_KEY;
  delete child.AWS_API_KEY;
  delete child.CYBER_API_KEY;
  delete child.CYBER_SUT_ENDPOINT;
  delete child.CYBER_ENDPOINT_ID;
  delete child.CYBER_MODEL;
  delete child.CLOUDFLARE_API_KEY;
  if (!mock) {
    const base = env.CLOUDFLARE_OPENAI_BASE_URL;
    const token = env.CLOUDFLARE_API_KEY;
    if (!base || !token) {
      throw new Error('set CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_API_KEY');
    }
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.pathname.endsWith('/chat/completions')) {
      throw new Error('Cloudflare base URL must be HTTPS and end before /chat/completions');
    }
    child.CYBER_SUT_ENDPOINT = base;
    child.CYBER_API_KEY = token;
    child.CYBER_ENDPOINT_ID = ENDPOINT_ID;
    child.CYBER_MODEL = MODEL;
  }
  return child;
}

export function verifyEndpointBinding(env, mock = false) {
  if (mock) {
    return;
  }
  const actual = crypto
    .createHash('sha256')
    .update(env.CLOUDFLARE_OPENAI_BASE_URL ?? '')
    .digest('hex');
  if (actual !== BASE_URL_SHA256) {
    throw new Error('Cloudflare base URL changed after preregistration');
  }
}

export function buildInvocation(args) {
  const mode = args.mode === 'pilot-offense' ? 'offense' : args.mode;
  const seeds =
    args.mode === 'pilot-offense'
      ? [PILOT_SEED]
      : mode === 'offense'
        ? OFFENSE_SEEDS
        : DEFENSE_SEEDS;
  const argv = [scripts[mode], '--seeds', seeds.join(','), '--output', args.output];
  if (mode === 'offense') {
    argv.push(
      '--mode',
      'offense',
      '--families',
      'multi-identity-fanout',
      '--concurrency',
      '1',
      '--max-turns',
      args.mode === 'pilot-offense' ? '1' : '80',
      '--max-tokens',
      '8192',
      '--timeout-ms',
      '300000',
    );
  } else {
    argv.push('--max-tokens', '8192', '--timeout-ms', '300000');
  }
  if (args.mock) {
    argv.push('--mock-reference');
  }
  if (args.resume) {
    argv.push('--resume');
  }
  return { mode, seeds, argv };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  verifyEndpointBinding(process.env, args.mock);
  const env = cloudflareChildEnv(process.env, args.mock);
  const invocation = buildInvocation(args);
  process.umask(0o077);
  process.stdout.write(
    `F10 v7 ${args.mode}: ${invocation.seeds.length} fixed seeds, ${args.mock ? 'reference' : MODEL}, output ${args.output}\n`,
  );
  const child = spawn(process.execPath, invocation.argv, { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) {
    throw new Error(`frozen ${invocation.mode} runner exited ${code}`);
  }
  const mode = fs.statSync(args.output).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`raw output mode ${mode.toString(8)} is not 0600`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
