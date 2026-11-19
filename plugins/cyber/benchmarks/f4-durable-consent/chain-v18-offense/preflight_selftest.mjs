import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const sourceRoots = [
  'chain-v3/offense.mjs',
  'chain-v3/runner.mjs',
  'chain-cloudflare-v3/offense-preload.mjs',
  'chain-cloudflare-v3/pace.mjs',
];
const expectedSourceSha256 = {
  'chain-cloudflare-v2/transport-preload.mjs':
    'f5bb2f9b9df1489e1ded8b91a3ff08e4b6e7890615a0405b862a6c5582299fae',
  'chain-cloudflare-v3/offense-preload.mjs':
    '8ee704d7814c04c76643562b4d31aef283a6842fcc508c77330376dbcf4614de',
  'chain-cloudflare-v3/pace.mjs':
    'd9f490b46e8d08ae0a74362de7a92aa803e8b4873a0a6ab6ff6b2cb08085c3bc',
  'chain-v3/defense.mjs': '367f5cbb6bd958bbce590a6c3f9e129a9afacc27918773204372f550e0566e69',
  'chain-v3/offense.mjs': '2771a43487424be88b9976464ab85c1b988e8466134b3cb376970aea2b9a1541',
  'chain-v3/runner.mjs': 'ac58dd7fc603e679f221f9f2696a43d35477249e6a29830973ced796c6c66dd3',
  'defense/scripts/harness.mjs': '74435f6cbdda2f27731adc544ef2a0eb637dcc1bb0231732382c3ee0c6ec9aca',
  'shared/estate.mjs': '726ab7beab63aeb6fc1a7b4fc7548f424c12c699a51ab6764d13d8173dc9bafc',
};

function localImports(source) {
  return [
    ...source.matchAll(/^\s*import\s+(?:[^;]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]\s*;/gmu),
    ...source.matchAll(/^\s*export\s+(?:\*|\{[^;]*?\})\s+from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;/gmu),
    ...source.matchAll(/\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu),
  ].map((match) => match[1]);
}

function sourceClosure() {
  const visited = new Set();
  const pending = [...sourceRoots];
  while (pending.length > 0) {
    const relative = pending.pop();
    if (visited.has(relative)) {
      continue;
    }
    const absolute = path.resolve(familyRoot, relative);
    assert.ok(absolute.startsWith(`${familyRoot}${path.sep}`), `outside F4 root: ${relative}`);
    const source = fs.readFileSync(absolute, 'utf8');
    visited.add(relative);
    for (const dependency of localImports(source)) {
      const resolved = path.resolve(path.dirname(absolute), dependency);
      pending.push(path.relative(familyRoot, resolved));
    }
  }
  return [...visited].sort();
}

test('fresh offense grid has nine unseen seeds and all four families per seed', async () => {
  const [{ SEEDS, REQUEST_SETTINGS }, { grid }] = await Promise.all([
    import('./config.mjs'),
    import('./preflight.mjs'),
  ]);
  assert.deepEqual(SEEDS, [41021, 41022, 41023, 41024, 41025, 41026, 41027, 41028, 41029]);
  assert.ok(Object.isFrozen(SEEDS));
  assert.deepEqual(REQUEST_SETTINGS, {
    model_id: '@cf/zai-org/glm-5.3',
    endpoint_id: 'cloudflare-openai-compatible',
    reasoning_effort: 'low',
    max_tokens: 16384,
    temperature: 0,
    stream: false,
    request_timeout_ms: 300000,
    automatic_retries: 0,
    cache: false,
    concurrent_cases: 1,
    minimum_request_start_gap_ms: 5000,
  });
  assert.ok(Object.isFrozen(REQUEST_SETTINGS));

  const cases = grid();
  assert.equal(cases.length, 36);
  assert.deepEqual(
    cases,
    SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family }))),
  );
  assert.equal(new Set(cases.map(({ seed, family }) => `${seed}/${family}`)).size, 36);
  const oldSeeds = new Set([
    ...[10021, 11021, 12021, 13021].flatMap((first) =>
      Array.from({ length: 9 }, (_, offset) => first + offset),
    ),
    99021,
    99022,
  ]);
  assert.ok(cases.every(({ seed }) => !oldSeeds.has(seed)));
  for (const seed of SEEDS) {
    assert.deepEqual(
      cases.filter((item) => item.seed === seed).map((item) => item.family),
      FAMILIES,
    );
  }
});

test('source binding covers and hashes the full local import closure', async () => {
  const { verifySourceBindings } = await import('./preflight.mjs');
  const discovered = sourceClosure();
  assert.deepEqual(discovered, Object.keys(expectedSourceSha256).sort());
  const currentHashes = Object.fromEntries(
    discovered.map((relative) => [
      relative,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(familyRoot, relative)))
        .digest('hex'),
    ]),
  );
  assert.deepEqual(currentHashes, expectedSourceSha256);
  assert.deepEqual(verifySourceBindings({ source_sha256: expectedSourceSha256 }), currentHashes);
});

test('source binding rejects changed, omitted, extra, and malformed hashes', async () => {
  const { verifySourceBindings } = await import('./preflight.mjs');
  const changed = {
    ...expectedSourceSha256,
    'chain-v3/defense.mjs': '0'.repeat(64),
  };
  assert.throws(() => verifySourceBindings({ source_sha256: changed }), /source binding mismatch/u);
  const missing = { ...expectedSourceSha256 };
  delete missing['chain-cloudflare-v2/transport-preload.mjs'];
  assert.throws(() => verifySourceBindings({ source_sha256: missing }), /source binding mismatch/u);
  assert.throws(
    () =>
      verifySourceBindings({
        source_sha256: { ...expectedSourceSha256, 'chain-v3/unreviewed.mjs': '0'.repeat(64) },
      }),
    /source binding mismatch/u,
  );
  assert.throws(
    () =>
      verifySourceBindings({
        source_sha256: { ...expectedSourceSha256, 'chain-v3/runner.mjs': 'x' },
      }),
    /source binding mismatch/u,
  );
});
