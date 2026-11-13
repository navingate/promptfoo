import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { referenceDefense } from '../v3/defense.mjs';
import { loadBatch } from './capture-consumer.mjs';
import {
  assertSafeOutputPath,
  parseLabels,
  runDefenseCase,
  selectApiKey,
  writeOutput,
} from './defense-runner.mjs';

const cfg = { screenDeadlineMs: Date.now() + 60000 };

test('JSON labels allow a fence but reject extra prose and arrays', () => {
  assert.deepEqual(parseLabels('```json\n{"flow-a":"benign"}\n```'), { 'flow-a': 'benign' });
  assert.equal(parseLabels('hello {"flow-a":"benign"}'), null);
  assert.equal(parseLabels('[]'), null);
});

test('reference mode scores one vendored native batch', async () => {
  const result = await runDefenseCase(12001, { mock: true }, cfg);
  assert.equal(result.classification, 'pass');
  assert.equal(result.score.exact, true);
  await assert.rejects(runDefenseCase(13001, { mock: true }, cfg), /unknown vendored/);
});

test('model request contains exact visible capture and excludes evaluator sidecars', async () => {
  const batch = loadBatch(12001);
  let calls = 0;
  const request = async (messages) => {
    calls += 1;
    assert.equal(messages.length, 2);
    const staged = messages[1].content;
    assert.equal(messages[1].role, 'user');
    assert.deepEqual(JSON.parse(staged).captures, batch.captures);
    assert.equal(staged.includes('"labels"'), false);
    assert.equal(staged.includes('"nonce"'), false);
    assert.equal(staged.includes('"sink"'), false);
    return {
      kind: 'ok',
      text: JSON.stringify(referenceDefense(batch)),
      served_model: 'zai.glm-5',
      finish_reason: 'stop',
      transport: { attempts: 1, transient_errors: [] },
    };
  };
  const result = await runDefenseCase(12001, { mock: false }, cfg, request);
  assert.equal(calls, 1);
  assert.equal(result.classification, 'pass');
});

test('one format correction is allowed, with no second scoring shortcut', async () => {
  const batch = loadBatch(12002);
  let calls = 0;
  const request = async (messages) => {
    calls += 1;
    assert.equal(messages.length, calls === 1 ? 2 : 4);
    return {
      kind: 'ok',
      text: calls === 1 ? 'not JSON' : JSON.stringify(referenceDefense(batch)),
      served_model: 'zai.glm-5',
      finish_reason: 'stop',
      transport: { attempts: 1, transient_errors: [] },
    };
  };
  const result = await runDefenseCase(12002, { mock: false }, cfg, request);
  assert.equal(calls, 2);
  assert.equal(result.classification, 'pass');
  assert.equal(result.transcript[0].score.valid, false);
  assert.equal(result.transcript[1].score.exact, true);
});

test('provider error remains separate from model failure', async () => {
  const result = await runDefenseCase(12003, { mock: false }, cfg, async () => ({
    kind: 'provider_error',
    reason: 'request-wall-limit',
    transport: { attempts: 7, transient_errors: ['TypeError'] },
  }));
  assert.equal(result.classification, 'provider_error');
  assert.equal(result.reason, 'request-wall-limit');
  assert.equal(result.transcript.length, 0);
});

test('gateway credential selection never falls through to an OpenAI key', () => {
  assert.equal(selectApiKey({ OPENAI_API_KEY: 'unrelated' }), undefined);
  assert.equal(selectApiKey({ AWS_API_KEY: 'gateway' }), 'gateway');
  assert.equal(selectApiKey({ CYBER_API_KEY: 'specific', AWS_API_KEY: 'gateway' }), 'specific');
});

test('raw output is atomic, private, and outside the repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-defense-output-'));
  try {
    const output = path.join(dir, 'capture.json');
    assert.throws(
      () => assertSafeOutputPath(new URL('./capture.json', import.meta.url).pathname),
      /outside/,
    );
    writeOutput(output, { results: [{ seed: 12001 }] });
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')).results, [{ seed: 12001 }]);
    writeOutput(output, { results: [{ seed: 12001 }, { seed: 12002 }] });
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
