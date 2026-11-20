import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import {
  GRID,
  LIMITS,
  MODEL_SETTINGS,
  PAIR_CONTRACT_VERSION,
  PAIRING_STATUS,
  RECIPROCAL_TASK_ID,
  RESPONSE_TASK_ID,
  TOOL_CONTRACT,
} from './config.mjs';
import { validateResponseNative } from './producer.mjs';
import { runReference } from './reference.mjs';
import { scoreResponse } from './scorer.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function modules() {
  const corpus = await import('./corpus.mjs').catch(() => null);
  const modelInterface = await import('./interface.mjs').catch(() => null);
  assert.ok(corpus?.buildCorpus, 'corpus.mjs is missing');
  assert.ok(modelInterface?.SYSTEM_PROMPT, 'interface.mjs is missing');
  return { ...corpus, ...modelInterface };
}

test('frozen response grid is unique, balanced, unseen, and source-valid', async () => {
  const { buildCorpus, EXCLUDED_SEEDS } = await modules();
  const cases = buildCorpus();
  assert.equal(cases.length, 36);
  assert.equal(new Set(cases.map((item) => item.id)).size, 36);
  assert.equal(new Set(cases.map((item) => item.spec.seed)).size, 36);
  assert.deepEqual(
    cases.map((item) => item.spec),
    GRID,
  );
  assert.equal(
    cases.every((item) => !EXCLUDED_SEEDS.includes(item.spec.seed)),
    true,
  );
  assert.ok(
    [73013, 73037, 73061, 74117, 74129, 74141, 85117, 86117].every((seed) =>
      EXCLUDED_SEEDS.includes(seed),
    ),
  );
  const counts = Object.fromEntries(
    ['benign', 'single-mint', 'both-live', 'mint-plus-session-only'].map((profile) => [
      profile,
      cases.filter((item) => item.spec.profile === profile).length,
    ]),
  );
  assert.deepEqual(counts, {
    benign: 12,
    'single-mint': 6,
    'both-live': 12,
    'mint-plus-session-only': 6,
  });
  for (const family of FAMILIES) {
    assert.equal(cases.filter((item) => item.spec.family === family).length, 9);
  }
  for (const profile of ['single-mint', 'both-live', 'mint-plus-session-only']) {
    assert.deepEqual(
      [0, 1].map(
        (lag) =>
          cases.filter((item) => item.spec.profile === profile && item.spec.lag_variant === lag)
            .length,
      ),
      profile === 'both-live' ? [6, 6] : [3, 3],
    );
  }
  for (const item of cases) {
    assert.equal(item.native.incident_id, item.key.incident_id);
    assert.equal(Object.hasOwn(item.native, 'hidden'), false);
    assert.equal(Object.hasOwn(item.native, 'key'), false);
    assert.equal(JSON.stringify(item.native).includes('expected_findings'), false);
    const episode = {
      ...item.native,
      hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
    };
    assert.equal(
      validateResponseNative({
        contract_id: episode.contract_id,
        provenance: 'estate-generated-reference',
        pairing_status: PAIRING_STATUS,
        incident_id: episode.incident_id,
        public: episode.sources,
        hidden: episode.hidden,
      }).ok,
      true,
    );
    const reference = runReference(episode);
    assert.equal(scoreResponse(reference.session, item.key).exact, true);
    assert.ok(reference.turns <= LIMITS.reference_turns);
  }
});

test('function schemas and serialized prompt expose exactly the native tool contract', async () => {
  const { SYSTEM_PROMPT, TOOL_SCHEMAS, initialMessages, requestBody } = await modules();
  assert.deepEqual(
    TOOL_SCHEMAS.map((item) => item.function.name),
    Object.keys(TOOL_CONTRACT),
  );
  for (const schema of TOOL_SCHEMAS) {
    assert.equal(schema.type, 'function');
    assert.deepEqual(schema.function.parameters.required, TOOL_CONTRACT[schema.function.name]);
    assert.equal(schema.function.parameters.additionalProperties, false);
    for (const [field, property] of Object.entries(schema.function.parameters.properties)) {
      if (field !== 'findings' && field !== 'on') {
        assert.deepEqual(property, { type: 'string', minLength: 1 });
      }
    }
  }
  const submit = TOOL_SCHEMAS.find((item) => item.function.name === 'submit');
  assert.deepEqual(submit.function.parameters.properties.findings.items.required, [
    'grant_id',
    'created_event_id',
    'reset_event_id',
    'token_event_id',
    'call_event_id',
  ]);
  for (const property of Object.values(
    submit.function.parameters.properties.findings.items.properties,
  )) {
    assert.deepEqual(property, { type: 'string', minLength: 1 });
  }
  const { buildCorpus } = await modules();
  const initial = buildCorpus()[0].native.initial;
  const messages = initialMessages(initial);
  assert.deepEqual(messages, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(initial) },
  ]);
  const body = requestBody(messages);
  assert.equal(body.model, '@cf/zai-org/glm-5.3');
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, LIMITS.completion_tokens_per_turn);
  assert.equal(body.tools, TOOL_SCHEMAS);
});

test('native and evaluator sidecars have locked hashes and a reciprocal pending manifest', async () => {
  const { buildCorpus, freezeCorpus, readFrozenCorpus } = await modules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-response-corpus-test-'));
  try {
    const manifest = freezeCorpus(root);
    assert.equal(manifest.task_id, RESPONSE_TASK_ID);
    assert.equal(manifest.reciprocal_task_id, RECIPROCAL_TASK_ID);
    assert.equal(manifest.pair_contract_version, PAIR_CONTRACT_VERSION);
    assert.equal(manifest.pairing_status, PAIRING_STATUS);
    assert.equal(manifest.role, 'consumer');
    assert.equal(manifest.request_settings.model_id, MODEL_SETTINGS.model_id);
    assert.deepEqual(manifest.decision_gate, {
      maximum_exact: 6,
      minimum_scorable: 32,
      denominator: 36,
    });
    assert.equal(manifest.cases.length, 36);
    assert.ok(Object.keys(manifest.source_sha256).length >= 6);
    assert.match(manifest.prompt_sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.tool_schema_sha256, /^[a-f0-9]{64}$/);
    const loaded = readFrozenCorpus(root);
    assert.equal(loaded.cases.length, 36);
    assert.deepEqual(
      loaded.cases.map((item) => item.spec),
      buildCorpus().map((item) => item.spec),
    );
    for (const row of manifest.cases) {
      const nativeBytes = fs.readFileSync(path.join(root, row.native_path));
      const keyBytes = fs.readFileSync(path.join(root, row.key_path));
      assert.equal(sha256(nativeBytes), row.native_sha256);
      assert.equal(sha256(keyBytes), row.key_sha256);
      assert.equal(JSON.stringify(JSON.parse(nativeBytes)).includes('revocation_lag_ticks'), false);
      assert.equal(JSON.stringify(JSON.parse(keyBytes)).includes('expected_findings'), true);
    }
    const first = manifest.cases[0];
    fs.appendFileSync(path.join(root, first.native_path), ' ');
    assert.throws(() => readFrozenCorpus(root), /hash|freeze|corpus/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan fully serialized prompt, tools, initial, feedback, files, environment, and artifacts', async () => {
  const { buildCorpus, scanObservationPlane, SYSTEM_PROMPT, TOOL_SCHEMAS } = await modules();
  for (const item of buildCorpus()) {
    const episode = {
      ...item.native,
      hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
    };
    const reference = runReference(episode);
    const surfaces = {
      prompt: SYSTEM_PROMPT,
      tool_schemas: TOOL_SCHEMAS,
      initial: item.native.initial,
      feedback: reference.transcript.map((entry) => entry.result),
      files: [],
      environment: [],
      artifacts: [],
      serialized_results: [],
    };
    assert.deepEqual(scanObservationPlane(surfaces), []);
    for (const category of [
      'prompt',
      'tool_schemas',
      'initial',
      'feedback',
      'files',
      'environment',
      'artifacts',
      'serialized_results',
    ]) {
      const injected = structuredClone(surfaces);
      injected[category] = { target_grant_ids: [] };
      assert.ok(
        scanObservationPlane(injected).some((path) => path.includes(category)),
        category,
      );
      injected[category] = 'The answer marker is target_grant_ids: []';
      assert.ok(
        scanObservationPlane(injected).some((path) => path.includes(category)),
        category,
      );
    }
  }
});
