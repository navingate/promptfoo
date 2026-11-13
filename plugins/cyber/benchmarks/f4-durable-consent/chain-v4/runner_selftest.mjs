import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { loadFrozenCases, modelCall, runCase } from './runner.mjs';

const spec = { seed: 11021, family: FAMILIES[0] };
const config = { endpoint: 'https://example.invalid', endpointId: 'test', model: 'zai.glm-5' };
const frozenCases = loadFrozenCases();
const response = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'zai.glm-5',
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
  }),
});

test('transport and served-model errors are separate and never retried silently', async () => {
  let calls = 0;
  const throttled = await runCase(spec, 'stage', {
    config,
    frozenCases,
    request: async () => {
      calls += 1;
      return { ok: false, status: 429 };
    },
  });
  assert.equal(throttled.classification, 'provider_error');
  assert.equal(calls, 1);
  const mismatch = await modelCall([], config, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'different-model',
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    }),
  }));
  assert.equal(mismatch.issue, 'invalid_run');
});

test('a denied credential attempt can recover before exact native export', async () => {
  let calls = 0;
  const commands = (messages) => {
    const initial = JSON.parse(messages[1].content);
    const previous = messages.at(-1)?.role === 'user' ? JSON.parse(messages.at(-1).content) : null;
    if (calls === 1) {
      return { tool: 'refresh-access', args: { refresh_token: 'wrong' } };
    }
    if (calls === 2) {
      return { tool: 'refresh-access', args: { refresh_token: initial.refresh_token } };
    }
    if (calls === 3) {
      return { tool: 'call-protected-api', args: { access_token: previous.access_token } };
    }
    if (calls === 4) {
      return { tool: 'read-export', args: { export_ref: previous.export_ref } };
    }
    return { tool: 'submit', args: { value: previous.value } };
  };
  const result = await runCase(spec, 'stage', {
    config,
    frozenCases,
    request: async (_url, init) => {
      calls += 1;
      return response(commands(JSON.parse(init.body).messages));
    },
  });
  assert.equal(result.classification, 'pass');
  assert.equal(result.score.checks.exact_value, true);
  assert.equal(calls, 5);
});

test('malformed model commands remain format failures', async () => {
  const result = await runCase(spec, 'defense', {
    config,
    frozenCases,
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'zai.glm-5',
        choices: [{ message: { content: 'I cannot decide.' }, finish_reason: 'stop' }],
      }),
    }),
  });
  assert.equal(result.classification, 'format_fail');
  assert.equal(result.score.valid_output, false);
});
