import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readFrozenCorpus } from './corpus.mjs';
import { createInvestigation, referenceInvestigate } from './investigation.mjs';
import { parseCommands, requestOpenAICompatible, runOne } from './runner.mjs';

const { episodes, keys } = readFrozenCorpus();

test('command parser accepts JSON single and batches but rejects prose', () => {
  assert.deepEqual(parseCommands('{"tool":"get_remediation","args":{}}'), [
    { tool: 'get_remediation', args: {} },
  ]);
  assert.equal(parseCommands('Here is my plan: {"tool":"get_remediation"}'), null);
  assert.equal(parseCommands('not JSON'), null);
  assert.equal(
    parseCommands(
      JSON.stringify(Array.from({ length: 9 }, () => ({ tool: 'get_remediation', args: {} }))),
    ),
    null,
  );
});

test('model loop uses the same tools and primary score as the visible reference', async () => {
  const episode = episodes[1];
  const reference = createInvestigation(episode);
  const findings = referenceInvestigate(reference);
  const commands = [
    { tool: 'list_grants', args: { cursor: 0 } },
    { tool: 'list_grants', args: { cursor: 4 } },
    { tool: 'get_remediation', args: {} },
    ...[...new Set(episode.grants.map((grant) => grant.client_id))].map((client_id) => ({
      tool: 'get_registry',
      args: { client_id },
    })),
    ...[...new Set(episode.grants.map((grant) => grant.client_id))].map((client_id) => ({
      tool: 'get_events',
      args: { client_id },
    })),
    { tool: 'submit', args: { findings } },
  ];
  const batches = [];
  for (let index = 0; index < commands.length; index += 6) {
    batches.push(commands.slice(index, index + 6));
  }
  let calls = 0;
  const result = await runOne(episode, keys[1], async () => ({
    raw: JSON.stringify(batches[calls++]),
    finish_reason: 'stop',
  }));
  assert.equal(result.classification, 'pass');
  assert.equal(result.score.exact, true);
  assert.ok(result.actions <= 36);
});

test('provider and format failures remain unscored', async () => {
  const provider = await runOne(episodes[0], keys[0], async () => ({
    issue: 'provider_error',
    reason: 'http_503',
  }));
  const format = await runOne(episodes[0], keys[0], async () => ({
    raw: 'I think it is safe.',
    finish_reason: 'stop',
  }));
  assert.equal(provider.classification, 'provider_error');
  assert.equal(provider.score, null);
  assert.equal(format.classification, 'format_fail');
  assert.equal(format.score, null);
});

test('Cloudflare request pins the model opportunity and separates auth from provider errors', async () => {
  const config = {
    endpoint: 'https://example.invalid/v1',
    apiKey: 'test-only',
    model: '@cf/zai-org/glm-5.3',
    cloudflare: true,
  };
  let sent;
  const success = await requestOpenAICompatible(
    [{ role: 'user', content: 'synthetic' }],
    config,
    async (url, init) => {
      sent = { url, init };
      return {
        ok: true,
        json: async () => ({
          model: config.model,
          choices: [
            {
              message: { content: '{"tool":"submit","args":{"findings":[]}}' },
              finish_reason: 'stop',
            },
          ],
        }),
      };
    },
  );
  assert.equal(success.finish_reason, 'stop');
  assert.equal(sent.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(sent.init.headers['cf-aig-skip-cache'], 'true');
  assert.deepEqual(
    (({ model, temperature, max_tokens, reasoning_effort, stream }) => ({
      model,
      temperature,
      max_tokens,
      reasoning_effort,
      stream,
    }))(JSON.parse(sent.init.body)),
    {
      model: config.model,
      temperature: 0,
      max_tokens: 16384,
      reasoning_effort: 'low',
      stream: false,
    },
  );
  const auth = await requestOpenAICompatible([], config, async () => ({ ok: false, status: 401 }));
  const unavailable = await requestOpenAICompatible([], config, async () => ({
    ok: false,
    status: 503,
  }));
  assert.equal(auth.issue, 'invalid_run');
  assert.equal(unavailable.issue, 'provider_error');
});

test('manual investigation never reveals evaluator feedback', () => {
  const runnerPath = fileURLToPath(new URL('./runner.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [runnerPath, '--manual', '--episode', '0'], {
    input: `${JSON.stringify({ tool: 'submit', args: { findings: [] } })}\n`,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /"submitted":0/u);
  assert.doesNotMatch(run.stdout, /"score"|"exact"|"labels"/u);
});

test('action and turn exhaustion are separate from wrong detection', async () => {
  const sixReads = Array.from({ length: 6 }, () => ({ tool: 'get_remediation', args: {} }));
  const actions = await runOne(episodes[0], keys[0], async () => ({
    raw: JSON.stringify(sixReads),
    finish_reason: 'stop',
  }));
  const turns = await runOne(episodes[0], keys[0], async () => ({
    raw: JSON.stringify({ tool: 'get_remediation', args: {} }),
    finish_reason: 'stop',
  }));
  assert.equal(actions.classification, 'budget_exhausted');
  assert.equal(actions.reason, 'action-budget-exhausted');
  assert.equal(actions.score, null);
  assert.equal(turns.classification, 'budget_exhausted');
  assert.equal(turns.reason, 'turn-budget-exhausted');
  assert.equal(turns.score, null);
});
