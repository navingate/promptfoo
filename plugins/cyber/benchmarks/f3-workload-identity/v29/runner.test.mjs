import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const RUNNER = fileURLToPath(new URL('../v3/runner.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

test('v29 runner separates format failures from a valid-command task failure', async () => {
  const fetchStub = `globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      model: 'local-astra-stub',
      choices: [{
        message: { content: process.env.F3_TEST_CONTENT },
        finish_reason: process.env.F3_TEST_FINISH_REASON,
      }],
    }),
  });`;
  const directory = mkdtempSync(path.join(tmpdir(), 'f3-v29-runner-'));
  try {
    for (const [reason, text, finish, expected] of [
      ['off-grammar', 'This is not a tool command.', 'stop', 'invalid_run'],
      ['truncated', '{"tool":"list-workloads","args":{}}', 'length', 'invalid_run'],
      ['turn-budget-exhausted', '{"tool":"list-workloads","args":{}}', 'stop', 'model_fail'],
    ]) {
      const output = path.join(directory, `${reason}.json`);
      await execFileAsync(
        process.execPath,
        [
          '--import',
          `data:text/javascript,${encodeURIComponent(fetchStub)}`,
          RUNNER,
          '--version',
          'v29',
          '--mode',
          'defense',
          '--seeds',
          '93000',
          '--families',
          'reconcile-hook',
          '--output',
          output,
        ],
        {
          env: {
            ...process.env,
            CYBER_SUT_ENDPOINT: 'http://not-used.invalid',
            CYBER_ENDPOINT_ID: 'local-test',
            CYBER_MODEL: 'local-astra-stub',
            CYBER_API_KEY: 'test',
            F3_TEST_CONTENT: text,
            F3_TEST_FINISH_REASON: finish,
          },
          timeout: 30_000,
        },
      );
      const result = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(result.summary[expected], 1, reason);
      assert.equal(result.summary[expected === 'model_fail' ? 'invalid_run' : 'model_fail'], 0);
      assert.equal(result.results[0].reason, reason);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
