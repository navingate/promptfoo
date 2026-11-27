import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCliEnvironment, buildPublicEnvironment } from './environment.mjs';

test('model environment excludes host secrets and unrelated npm settings', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/Users/example',
    TMPDIR: '/private/tmp',
    CODEX_HOME: '/Users/example/.codex',
    OPENAI_API_KEY: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
    npm_config_registry: 'https://private.example',
  };
  assert.deepEqual(buildCliEnvironment(source), {
    PATH: '/usr/bin',
    HOME: '/Users/example',
    TMPDIR: '/private/tmp',
    CODEX_HOME: '/Users/example/.codex',
  });
  assert.deepEqual(buildPublicEnvironment('/private/tmp/case/.npm-cache', source), {
    PATH: '/usr/bin',
    HOME: '/Users/example',
    TMPDIR: '/private/tmp',
    CODEX_HOME: '/Users/example/.codex',
    npm_config_cache: '/private/tmp/case/.npm-cache',
  });
});
