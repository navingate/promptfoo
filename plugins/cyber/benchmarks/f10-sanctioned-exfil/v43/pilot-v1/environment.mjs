import assert from 'node:assert/strict';
import path from 'node:path';

export function buildCliEnvironment(source = process.env) {
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'CODEX_HOME']
      .filter((name) => typeof source[name] === 'string' && source[name].length > 0)
      .map((name) => [name, source[name]]),
  );
  assert.ok(env.PATH && env.HOME, 'missing-cli-environment');
  return env;
}

export function buildPublicEnvironment(cache, source = process.env) {
  assert.ok(path.isAbsolute(cache), 'npm-cache-must-be-absolute');
  return { ...buildCliEnvironment(source), npm_config_cache: cache };
}
