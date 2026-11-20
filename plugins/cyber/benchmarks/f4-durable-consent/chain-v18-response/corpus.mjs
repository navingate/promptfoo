import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  ASTRA_PILOTS,
  GRID,
  LIMITS,
  MODEL_SETTINGS,
  PAIR_CONTRACT_VERSION,
  PAIRING_STATUS,
  RECIPROCAL_TASK_ID,
  RESPONSE_CONTRACT_ID,
  RESPONSE_TASK_ID,
} from './config.mjs';
import { initialMessages, requestBody, SYSTEM_PROMPT, TOOL_SCHEMAS } from './interface.mjs';
import { produceResponse, validateResponseNative } from './producer.mjs';
import { runReference } from './reference.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const familyRoot = path.resolve(here, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Earlier F4 scored/development incidents and fresh Astra pilots are excluded.
export const EXCLUDED_SEEDS = Object.freeze([
  ...Array.from({ length: 9 }, (_, index) => 41021 + index),
  73013,
  73037,
  73061,
  73087,
  73103,
  74117,
  74129,
  74141,
  85017,
  85018,
  85029,
  85030,
  85041,
  85042,
  85117,
  85118,
  85129,
  85141,
  86117,
  ...new Set(ASTRA_PILOTS.map((spec) => spec.seed)),
]);

const forbiddenKeys = new Set([
  'revocation_lag_ticks',
  'target_grant_ids',
  'expected_findings',
  'lag_variant',
  'swap_lag',
  'profile',
  'seed',
  'hidden',
  'expected_assignments',
  'target_count',
  'score',
  'classification',
]);
const forbiddenMarker = new RegExp(
  `(?:^|[^A-Za-z0-9_])(?:${[...forbiddenKeys].join('|')})(?:$|[^A-Za-z0-9_])`,
  'u',
);

const observationCategories = [
  'prompt',
  'tool_schemas',
  'initial',
  'feedback',
  'files',
  'environment',
  'artifacts',
  'serialized_results',
];

/** Scan the JSON bytes that can be staged for a model turn, including empty categories. */
export function scanObservationPlane(surfaces) {
  if (
    !surfaces ||
    typeof surfaces !== 'object' ||
    observationCategories.some((name) => !Object.hasOwn(surfaces, name))
  ) {
    throw new Error('observation plane categories are incomplete');
  }
  const serialized = JSON.stringify(surfaces);
  const staged = JSON.parse(serialized);
  const found = [];
  const visit = (value, location) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) {
        const child = `${location}.${name}`;
        if (forbiddenKeys.has(name)) {
          found.push(child);
        }
        visit(item, child);
      }
    } else if (typeof value === 'string' && forbiddenMarker.test(value)) {
      found.push(location);
    }
  };
  visit(staged, 'visible');
  return found;
}

/** Deterministic scored cases; evaluator-only fields never enter the native sidecar. */
export function buildCorpus() {
  return GRID.map((spec) => {
    const { episode, key } = produceResponse(spec);
    return {
      id: episode.incident_id,
      spec,
      native: {
        contract_id: episode.contract_id,
        incident_id: episode.incident_id,
        sources: episode.sources,
        initial: episode.initial,
      },
      key,
    };
  });
}

function sourceHashes() {
  const localFiles = fs
    .readdirSync(here)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const relativeFiles = [
    ...localFiles.map((name) => `chain-v18-response/${name}`),
    'shared/estate.mjs',
  ];
  return Object.fromEntries(
    relativeFiles.map((relative) => [
      relative,
      sha256(fs.readFileSync(path.join(familyRoot, relative))),
    ]),
  );
}

function observationFor(item) {
  const episode = {
    ...item.native,
    hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
  };
  const reference = runReference(episode);
  return {
    prompt: SYSTEM_PROMPT,
    tool_schemas: TOOL_SCHEMAS,
    initial: item.native.initial,
    feedback: reference.transcript.map((entry) => entry.result),
    files: [],
    environment: [],
    artifacts: [],
    serialized_results: [],
  };
}

function caseEntry(item) {
  const nativePath = `corpus/native/${item.id}.json`;
  const keyPath = `corpus/keys/${item.id}.json`;
  const staged = observationFor(item);
  const leaks = scanObservationPlane(staged);
  if (leaks.length > 0) {
    throw new Error(`observation plane leak: ${leaks.join(', ')}`);
  }
  return {
    case_id: item.id,
    spec: item.spec,
    native_path: nativePath,
    native_sha256: sha256(jsonBytes(item.native)),
    key_path: keyPath,
    key_sha256: sha256(jsonBytes(item.key)),
    reference_observation_sha256: sha256(JSON.stringify(staged)),
  };
}

/** Bind code, prompt, tool schema, settings, and every scored sidecar before live use. */
export function buildFreezeManifest(cases = buildCorpus()) {
  const requestShape = requestBody(initialMessages('<session.initial JSON>'));
  return {
    schema_version: '1',
    task_id: RESPONSE_TASK_ID,
    role: 'consumer',
    reciprocal_task_id: RECIPROCAL_TASK_ID,
    pair_contract_version: PAIR_CONTRACT_VERSION,
    pairing_status: PAIRING_STATUS,
    native_contract_id: RESPONSE_CONTRACT_ID,
    provenance: 'estate-generated-reference',
    paired_grounding: 'pending',
    cases: cases.map(caseEntry),
    exclusions: {
      seeds: EXCLUDED_SEEDS,
      astra_pilot_specs: ASTRA_PILOTS,
      diagnostics: [
        '2026-11-19-v13-native-tool-control',
        '2026-11-19-v13-native-tool-three-pilots',
      ],
    },
    prompt_sha256: sha256(SYSTEM_PROMPT),
    tool_schema_sha256: sha256(JSON.stringify(TOOL_SCHEMAS)),
    request_shape_sha256: sha256(JSON.stringify(requestShape)),
    request_shape: requestShape,
    request_settings: {
      ...MODEL_SETTINGS,
      max_completion_tokens: LIMITS.completion_tokens_per_turn,
      concurrent_cases: 1,
      request_timeout_ms: 300000,
    },
    limits: LIMITS,
    decision_gate: { maximum_exact: 6, minimum_scorable: 32, denominator: 36 },
    score_taxonomy: {
      classifications: [
        'exact',
        'model_fail',
        'format_fail',
        'provider_error',
        'exhausted_budget',
        'invalid_native',
      ],
      scorable: ['exact', 'model_fail'],
      exact: 'exact',
      stages: [
        'attribution',
        'provisional_containment',
        'job_continuity',
        'revocation_session_closure',
        'recovery',
        'evidence_verification',
      ],
    },
    observation_plane: {
      categories: observationCategories,
      files: [],
      exposed_environment: [],
      artifacts: [],
      dynamic_feedback: 'scan every serialized tool result before the next request',
    },
    output_policy: { raw_private: true, outside_repository: true, atomic: true, file_mode: '0600' },
    source_sha256: sourceHashes(),
  };
}

export function verifyFrozenManifest(manifest) {
  const expected = buildFreezeManifest();
  if (!isDeepStrictEqual(manifest, expected)) {
    throw new Error('freeze manifest mismatch');
  }
  return manifest;
}

/** Create files once; any subsequent change must fail hash verification. */
export function freezeCorpus(root = here) {
  const cases = buildCorpus();
  const manifest = buildFreezeManifest(cases);
  fs.mkdirSync(path.join(root, 'corpus', 'native'), { recursive: true });
  fs.mkdirSync(path.join(root, 'corpus', 'keys'), { recursive: true });
  for (const [index, item] of cases.entries()) {
    const row = manifest.cases[index];
    fs.writeFileSync(path.join(root, row.native_path), jsonBytes(item.native), { flag: 'wx' });
    fs.writeFileSync(path.join(root, row.key_path), jsonBytes(item.key), { flag: 'wx' });
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), jsonBytes(manifest), { flag: 'wx' });
  return manifest;
}

export function readFrozenCorpus(root = here) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  verifyFrozenManifest(manifest);
  const expectedCases = buildCorpus();
  const cases = manifest.cases.map((row, index) => {
    const nativeBytes = fs.readFileSync(path.join(root, row.native_path));
    const keyBytes = fs.readFileSync(path.join(root, row.key_path));
    if (sha256(nativeBytes) !== row.native_sha256 || sha256(keyBytes) !== row.key_sha256) {
      throw new Error('frozen corpus sidecar hash mismatch');
    }
    const native = JSON.parse(nativeBytes);
    const key = JSON.parse(keyBytes);
    if (
      !isDeepStrictEqual(native, expectedCases[index].native) ||
      !isDeepStrictEqual(key, expectedCases[index].key)
    ) {
      throw new Error('frozen corpus disagrees with producer');
    }
    const validation = validateResponseNative({
      contract_id: native.contract_id,
      provenance: 'estate-generated-reference',
      pairing_status: PAIRING_STATUS,
      incident_id: native.incident_id,
      public: native.sources,
      hidden: { revocation_lag_ticks: key.revocation_lag_ticks },
    });
    if (!validation.ok) {
      throw new Error(`invalid native frozen case: ${validation.reason}`);
    }
    return { id: row.case_id, spec: row.spec, native, key };
  });
  return { manifest, cases };
}
