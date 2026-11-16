import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { captureResponse, runDiagnostic } from './diagnostic-screen.mjs';

test('response capture preserves the fetch response and request unchanged', async () => {
  const payload = JSON.stringify({ choices: [{ message: { content: '```sql\nSELECT 1\n```' } }] });
  let calls = 0;
  let observed;
  const request = captureResponse(
    async (url, init) => {
      calls += 1;
      observed = { url, init };
      return new Response(payload, { status: 200 });
    },
    (response) => {
      observed = { ...observed, response };
    },
  );
  const init = { method: 'POST', headers: { authorization: 'Bearer test-only' } };
  const result = await request('https://example.invalid/chat/completions', init);
  assert.equal(calls, 1);
  assert.strictEqual(observed.init, init);
  assert.equal(observed.response.status, 200);
  assert.equal(observed.response.body, payload);
  assert.equal(await result.text(), payload);
});

test('a diagnostic sink error cannot turn a valid provider response into an error', async () => {
  const request = captureResponse(
    async () => new Response('{"ok":true}', { status: 200 }),
    () => {
      throw new Error('diagnostic storage unavailable');
    },
  );
  const result = await request('https://example.invalid', {});
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '{"ok":true}');
});

test('diagnostic run freezes a format failure and its full response in a private file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v11-diagnostic-'));
  try {
    const output = path.join(dir, 'diagnostic.json');
    let calls = 0;
    const result = await runDiagnostic({
      output,
      request: async () => {
        calls += 1;
        return new Response('{"choices":[{"message":{"content":"```sql"}}]}');
      },
      screen: async ({ request }) => {
        await request('https://example.invalid', {});
        return {
          transport_attempts: 1,
          submission: { classification: 'format_fail', reason: 'sql-output-format' },
          score: null,
        };
      },
    });
    const frozen = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(calls, 1);
    assert.equal(result.submission.classification, 'format_fail');
    assert.equal(frozen.diagnostic_response.status, 200);
    assert.match(frozen.diagnostic_response.body, /```sql/u);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
