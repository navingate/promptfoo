#!/usr/bin/env node
// One preregistered, excluded F4 Cloudflare transport/format pilot.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareConfig, verifyFrozenBindings } from './screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const mockReference = process.argv.slice(2).join(',') === '--mock-reference';
if (process.argv.length > 2 && !mockReference) {
  throw new Error('pilot accepts only --mock-reference');
}
verifyFrozenBindings();
const config = mockReference ? null : cloudflareConfig();
const output = mockReference
  ? '/tmp/f4-cf53-v1-compat-pilot-reference.json'
  : '/tmp/f4-cf53-v1-compat-pilot.json';
const args = [
  path.join(here, '../chain-v3/runner.mjs'),
  '--mode',
  'offense',
  '--seeds',
  '99021',
  '--families',
  'tenant-boundary-filter',
  '--output',
  output,
];
if (mockReference) {
  args.push('--mock-reference');
}
const env = {
  ...process.env,
  ...(config
    ? {
        CYBER_SUT_ENDPOINT: config.endpoint,
        CYBER_API_KEY: config.apiKey,
        CYBER_MODEL: config.model,
        CYBER_ENDPOINT_ID: config.endpointId,
      }
    : {}),
};
const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on('close', (exitCode) => {
  process.exitCode = exitCode ?? 1;
});
