#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KINDS, produceCase, verifyNativeProof } from './native.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const sources = [
  'G0-PROPOSAL.md',
  'FIELD-LINEAGE.md',
  'native.mjs',
  'native.test.mjs',
  'reference.mjs',
  'scorer.mjs',
  'screen.mjs',
  'freeze.mjs',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

export function expectedManifest(commit) {
  return {
    schema_version: 'f10-v24-v13-publisher-binding-g0-v1',
    source_commit: commit,
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))]),
    ),
    cases: KINDS.map((kind) => {
      const item = produceCase(61007, kind);
      assert.equal(verifyNativeProof(item.proof), true);
      return {
        kind,
        observation_sha256: digest(item.observation),
        proof_sha256: digest(item.proof),
        answer_sha256: digest(item.answer),
      };
    }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    for (const kind of KINDS) {
      const item = produceCase(61007, kind);
      for (const part of ['observation', 'proof', 'answer']) {
        fs.writeFileSync(
          path.join(evidence, `${kind}-${part}.json`),
          `${JSON.stringify(item[part], null, 2)}\n`,
        );
      }
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(expectedManifest(commit), null, 2)}\n`);
  } else {
    const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(frozen, expectedManifest(frozen.source_commit));
    for (const kind of KINDS) {
      const item = produceCase(61007, kind);
      for (const part of ['observation', 'proof', 'answer']) {
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(evidence, `${kind}-${part}.json`), 'utf8')),
          item[part],
        );
      }
    }
    process.stdout.write('F10 v24 G0 publisher binding manifest verified\n');
  }
}
