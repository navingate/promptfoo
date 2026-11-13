#!/usr/bin/env node
// Versioned, excluded Cloudflare transport pilots over frozen F4 v3 offense.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareConfig, verifyFrozenBindings } from '../chain-cloudflare-v1/screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const arms = Object.freeze({
  'b16-low': { max_tokens: 16384, reasoning_effort: 'low' },
  'b32-low': { max_tokens: 32768, reasoning_effort: 'low' },
});

function parseArgs(argv) {
  const args = { arm: null, mockReference: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--arm') {
      args.arm = argv[++index];
    } else if (argv[index] === '--mock-reference') {
      args.mockReference = true;
    } else {
      throw new Error(`unknown pilot option ${argv[index]}`);
    }
  }
  if (!Object.hasOwn(arms, args.arm)) {
    throw new Error('pilot requires a registered --arm');
  }
  return args;
}

function verifyPilotBindings() {
  verifyFrozenBindings();
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  for (const [relativePath, digest] of Object.entries(manifest.files)) {
    if (sha(fs.readFileSync(path.join(familyRoot, relativePath))) !== digest) {
      throw new Error(`F4 compatibility-pilot source binding mismatch: ${relativePath}`);
    }
  }
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = verifyPilotBindings();
  const arm = arms[args.arm];
  const config = args.mockReference ? null : cloudflareConfig();
  const output = `/tmp/f4-cf53-v2-pilot-${args.arm}${args.mockReference ? '-reference' : ''}.json`;
  const runnerArgs = [
    ...(config ? [`--import=${path.join(here, 'transport-preload.mjs')}`] : []),
    path.join(familyRoot, 'chain-v3/runner.mjs'),
    '--mode',
    'offense',
    '--seeds',
    '99022',
    '--families',
    'tenant-boundary-filter',
    '--output',
    output,
    ...(args.mockReference ? ['--mock-reference'] : []),
  ];
  const env = {
    ...process.env,
    ...(config
      ? {
          CYBER_SUT_ENDPOINT: config.endpoint,
          CYBER_API_KEY: config.apiKey,
          CYBER_MODEL: config.model,
          CYBER_ENDPOINT_ID: config.endpointId,
          F4_CF_PILOT_PRELOAD: '1',
          F4_CF_PILOT_BUDGET: String(arm.max_tokens),
          F4_CF_PILOT_REASONING: arm.reasoning_effort ?? '',
        }
      : {}),
  };
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, runnerArgs, { cwd: repoRoot, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }
  const capture = JSON.parse(fs.readFileSync(output, 'utf8'));
  capture.compatibility_pilot = {
    excluded: true,
    version: manifest.pilot_version,
    arm: args.arm,
    seed: 99022,
    family: 'tenant-boundary-filter',
    max_tokens: arm.max_tokens,
    reasoning_effort: arm.reasoning_effort ?? 'default',
    transport_source_sha256: manifest.files['chain-cloudflare-v2/transport-preload.mjs'],
  };
  fs.writeFileSync(output, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `pilot ${args.arm}: ${capture.results?.[0]?.classification ?? 'invalid_run'}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
