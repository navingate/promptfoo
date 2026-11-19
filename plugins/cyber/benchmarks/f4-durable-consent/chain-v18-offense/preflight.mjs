import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { SEEDS } from './config.mjs';

const familyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = Object.freeze([
  'chain-v3/offense.mjs',
  'chain-v3/runner.mjs',
  'chain-cloudflare-v3/offense-preload.mjs',
  'chain-cloudflare-v3/pace.mjs',
]);

export function grid() {
  return SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
}

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
    if (!absolute.startsWith(`${familyRoot}${path.sep}`)) {
      throw new Error(`source binding mismatch: outside F4 root: ${relative}`);
    }
    const source = fs.readFileSync(absolute, 'utf8');
    visited.add(relative);
    for (const dependency of localImports(source)) {
      const resolved = path.resolve(path.dirname(absolute), dependency);
      pending.push(path.relative(familyRoot, resolved));
    }
  }
  return [...visited].sort();
}

export function verifySourceBindings(manifest) {
  const expected = manifest?.source_sha256;
  const files = sourceClosure();
  if (
    !expected ||
    typeof expected !== 'object' ||
    Array.isArray(expected) ||
    JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(files)
  ) {
    throw new Error('source binding mismatch: file set');
  }
  const actual = {};
  for (const relative of files) {
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(familyRoot, relative)))
      .digest('hex');
    if (!/^[a-f0-9]{64}$/u.test(expected[relative]) || expected[relative] !== digest) {
      throw new Error(`source binding mismatch: ${relative}`);
    }
    actual[relative] = digest;
  }
  return actual;
}
