#!/usr/bin/env node
// One excluded DeepSeek compatibility case; no scored grid is started here.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_ID } from './transport.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const familyRoot = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
if (manifest.model_id !== MODEL_ID) {
  throw new Error('DeepSeek model binding mismatch');
}
for (const [relativePath, expected] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(path.join(familyRoot, relativePath));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`DeepSeek source binding mismatch: ${relativePath}`);
  }
}
const mock = process.argv.slice(2).join(',') === '--mock-reference';
if (process.argv.length > 2 && !mock) {
  throw new Error('pilot accepts only --mock-reference');
}
const endpoint = process.env.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '');
const apiKey = process.env.CLOUDFLARE_API_KEY;
if (!mock && (!endpoint || !apiKey || new URL(endpoint).protocol !== 'https:')) {
  throw new Error('DeepSeek pilot needs Cloudflare HTTPS endpoint and token');
}
const args = [
  ...(mock ? [] : [`--import=${path.join(here, 'transport.mjs')}`]),
  path.join(here, '../chain-v3/runner.mjs'),
  '--mode',
  'offense',
  '--seeds',
  '99023',
  '--families',
  'tenant-boundary-filter',
  '--output',
  mock ? '/tmp/f4-deepseek-v1-pilot-reference.json' : '/tmp/f4-deepseek-v1-pilot.json',
  ...(mock ? ['--mock-reference'] : []),
];
const env = {
  ...process.env,
  ...(mock
    ? {}
    : {
        CYBER_SUT_ENDPOINT: endpoint,
        CYBER_API_KEY: apiKey,
        CYBER_MODEL: MODEL_ID,
        CYBER_ENDPOINT_ID: 'cloudflare-deepseek-v4-pro',
        F4_DEEPSEEK_PILOT: '1',
      }),
};
const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
