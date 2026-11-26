#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { LIMITS, NATIVE_CONTRACT, TASK_ID, TOOL_CONTRACT } from './config.mjs';
import { createCase } from './estate.mjs';
import { SYSTEM_PROMPT, TOOL_DESCRIPTIONS } from './interface.mjs';
import { runReference } from './reference.mjs';
import { score } from './scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceFiles = [
  'config.mjs',
  'estate.mjs',
  'interface.mjs',
  'reference.mjs',
  'scorer.mjs',
  'pilot.mjs',
  'relay.mjs',
  'freeze.mjs',
];
const seeds = [41, 53, 67];

export function makeManifest() {
  const visibleToolContract = JSON.stringify({
    contract: TOOL_CONTRACT,
    descriptions: TOOL_DESCRIPTIONS,
  });
  const cases = [];
  for (const seed of seeds) {
    for (const kind of ['positive', 'benign']) {
      const episode = createCase(seed, kind);
      const reference = runReference({
        contract_id: episode.contract_id,
        initial: episode.initial,
        public: episode.public,
      });
      const result = score(reference.session, episode);
      if (!result.exact) {
        throw new Error(`reference failed: ${seed}/${kind}`);
      }
      cases.push({
        id: `f4-handover-${seed}-${kind}`,
        seed,
        kind,
        public_sha256: sha256(JSON.stringify({ initial: episode.initial, public: episode.public })),
        reference_exact: true,
      });
    }
  }
  return {
    task_id: TASK_ID,
    contract_id: NATIVE_CONTRACT,
    candidate_version: 'v20-handover-2',
    base_design_commit: '81f5039ec6',
    mode: 'incident-response',
    provenance: 'synthetic-native-estate',
    pairing_status: 'pending-offense-capture-conformance',
    score_relationship: 'separate-from-all-prior-F4-response-scores',
    model: 'gpt-6.2-astra',
    cyber_access_program: 'standard',
    pilot_pairs: 3,
    limits: LIMITS,
    system_prompt_sha256: sha256(SYSTEM_PROMPT),
    tool_contract_sha256: sha256(visibleToolContract),
    source_sha256: Object.fromEntries(
      sourceFiles.map((file) => [file, sha256(fs.readFileSync(path.join(here, file)))]),
    ),
    observation_plane: {
      prompts: ['system prompt', 'initial observation'],
      files: [
        { path: 'blind/relay.mjs', sha256: sha256(fs.readFileSync(path.join(here, 'relay.mjs'))) },
        { path: 'blind/tools.json', sha256: sha256(visibleToolContract) },
      ],
      telemetry: ['native inspect and probe replies'],
      tool_descriptions: Object.keys(TOOL_DESCRIPTIONS),
      feedback: ['native action replies'],
      exposed_environment: {
        names: ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE'],
        value_digests: 'recorded-per-raw-pilot',
      },
      artifacts: [],
      serialized_results: ['HTTP JSON replies'],
      external_platform:
        'Codex CLI system instructions and shell tool are opaque and unhashed; observation-plane gate remains pending',
    },
    cases,
    review_gates: {
      construct: 'pending-independent-review',
      source_lineage: 'pending-independent-review',
      observation_plane: 'pending-independent-review',
      reference: 'pending-independent-review',
      shortcuts: 'pending-independent-review',
      scorer: 'pending-independent-review',
    },
  };
}

const target = path.join(here, 'manifest.json');
const expected = `${JSON.stringify(makeManifest(), null, 2)}\n`;
if (process.argv[2] === '--write' && process.argv.length === 3) {
  fs.writeFileSync(target, expected);
  process.stdout.write(`wrote ${target}\n`);
} else if (process.argv.length === 2) {
  if (!isDeepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), makeManifest())) {
    throw new Error('manifest drift');
  }
  process.stdout.write(`manifest verified: ${sha256(fs.readFileSync(target))}\n`);
} else {
  throw new Error('usage: freeze.mjs [--write]');
}
