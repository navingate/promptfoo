import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as manifestTools from './manifest.mjs';
import { serializeMessages } from './prompt.mjs';
import * as screen from './screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const checkoutRoot = path.resolve(repoRoot, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const sql = 'SELECT grant_id FROM grants WHERE 0';
const config = { endpoint: 'https://mock.invalid/v1', apiKey: 'mock-key' };
const cloudflareEndpoint = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1`;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const response = (content, { model = screen.MODEL_ID, finishReason = 'stop' } = {}) => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({ model, choices: [{ finish_reason: finishReason, message: { content } }] }),
});
const privateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v12-screen-'));
const mockOptions = (output, request) => ({
  mock: true,
  instance: 'a',
  output,
  request,
  preflight: async () => ({ networkUnavailable: true }),
});

test('raw SELECT and WITH SQL are accepted without token rewriting', () => {
  assert.equal(
    screen.normalizeSql('  SELECT grant_id\nFROM grants  '),
    'SELECT grant_id\nFROM grants',
  );
  assert.equal(
    screen.normalizeSql('\nWITH a AS (SELECT 1)\nSELECT * FROM a\n'),
    'WITH a AS (SELECT 1)\nSELECT * FROM a',
  );
});

test('one complete lowercase sql fence strips only the fence and outer whitespace', () => {
  assert.equal(
    screen.normalizeSql(' \n```sql\r\n\n  SELECT grant_id\nFROM grants  \n\r\n```\n '),
    'SELECT grant_id\nFROM grants',
  );
});

test('prose, nested or multiple fences, and malformed fences are rejected', () => {
  for (const content of [
    'Here is SQL:\nSELECT 1',
    '```sql\nSELECT 1\n```\nThis is the rule.',
    '```sql\nSELECT 1\n```\n```sql\nSELECT 2\n```',
    '```sql\nSELECT 1\n```sql\nSELECT 2\n```',
    '```sql\nSELECT 1',
    '```SQL\nSELECT 1\n```',
    '```sql\n\n```',
    'SELECT 1\n```',
    '',
  ]) {
    assert.throws(() => screen.normalizeSql(content), /SQL format/, JSON.stringify(content));
  }
});

test('normalized SQL has a strict 8192-byte limit', () => {
  assert.equal(screen.normalizeSql(`SELECT '${'x'.repeat(8183)}'`).length, 8192);
  assert.throws(() => screen.normalizeSql(`SELECT '${'x'.repeat(8184)}'`), /SQL format/);
  assert.throws(() => screen.normalizeSql(`SELECT '${'é'.repeat(4092)}'`), /SQL format/);
});

test('manifest has the exact exhaustive source set and three full request bindings', () => {
  assert.deepEqual(Object.keys(manifest.source_sha256).sort(), [...manifestTools.SOURCES].sort());
  const verified = manifestTools.verifyManifest(manifest);
  assert.deepEqual(Object.keys(verified).sort(), ['a', 'b', 'c']);
  for (const instance of ['a', 'b', 'c']) {
    assert.equal(verified[instance].batches.length, 36);
    assert.equal(verified[instance].keys.length, 36);
    assert.equal(verified[instance].controls.length, 16);
    assert.equal(verified[instance].messagesJson, serializeMessages(instance));
    assert.equal(JSON.parse(verified[instance].requestBodyJson).messages.length, 2);
    assert.equal(
      verified[instance].requestBodySha256,
      manifest.instances[instance].request_body_sha256,
    );
  }
});

test('manifest plans three total calls, one for each frozen instance', () => {
  assert.equal(manifest.planned_model_calls, 3);
  assert.equal(manifestTools.generateManifest().planned_model_calls, 3);
  assert.deepEqual(Object.keys(manifest.instances).sort(), ['a', 'b', 'c']);
  assert.throws(
    () => manifestTools.verifyManifest({ ...manifest, planned_model_calls: 1 }),
    /planned_model_calls setting mismatch/,
  );
});

test('missing, extra, and altered source bindings fail closed', () => {
  const missing = structuredClone(manifest);
  delete missing.source_sha256['shared/estate.mjs'];
  assert.throws(() => manifestTools.verifyManifest(missing), /source.*binding/);
  const extra = structuredClone(manifest);
  extra.source_sha256['chain-v12/unreviewed.mjs'] = '0'.repeat(64);
  assert.throws(() => manifestTools.verifyManifest(extra), /source.*binding/);
  const changed = structuredClone(manifest);
  changed.source_sha256['chain-v12/screen.mjs'] = '0'.repeat(64);
  assert.throws(() => manifestTools.verifyManifest(changed), /source.*binding/);
  assert.throws(
    () =>
      manifestTools.verifyManifest(manifest, {
        readBytes: (relative) =>
          relative === 'shared/estate.mjs'
            ? Buffer.from('tampered source')
            : fs.readFileSync(path.join(here, '..', relative)),
      }),
    /source.*binding/,
  );
});

test('all corpus, message, and full request-body hashes are checked before the request', async () => {
  const dir = privateDir();
  try {
    const variants = [
      ['native_sha256', 'b'],
      ['labels_sha256', 'c'],
      ['development_sha256', 'a'],
      ['messages_sha256', 'b'],
      ['request_body_sha256', 'c'],
    ];
    for (const [field, instance] of variants) {
      let calls = 0;
      const altered = structuredClone(manifest);
      altered.instances[instance][field] = '0'.repeat(64);
      const result = await screen.runScreen({
        ...mockOptions(path.join(dir, `${field}.json`), async () => {
          calls += 1;
          return response(sql);
        }),
        manifest: altered,
      });
      assert.equal(calls, 0, `${instance}/${field}`);
      assert.equal(result.transport_attempts, 0);
      assert.equal(result.score.classification, 'executor_fail');
      assert.match(result.score.reason, /binding mismatch/);
    }
    let calls = 0;
    const alteredSource = structuredClone(manifest);
    alteredSource.source_sha256['chain-v12/screen.mjs'] = '0'.repeat(64);
    const result = await screen.runScreen({
      ...mockOptions(path.join(dir, 'source.json'), async () => {
        calls += 1;
        return response(sql);
      }),
      manifest: alteredSource,
    });
    assert.equal(calls, 0);
    assert.equal(result.transport_attempts, 0);
    assert.match(result.score.reason, /source.*binding mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong served model, incomplete response, and missing SQL never execute', async () => {
  const dir = privateDir();
  try {
    const cases = [
      [response(sql, { model: 'other' }), 'provider_error'],
      [response(sql, { finishReason: 'length' }), 'format_fail'],
      [response(null), 'format_fail'],
      [response('```sql\nSELECT 1'), 'format_fail'],
    ];
    for (const [index, [reply, classification]] of cases.entries()) {
      let executions = 0;
      const output = path.join(dir, `${classification}-${index}.json`);
      const result = await screen.runScreen({
        ...mockOptions(output, async () => reply),
        execute: async () => {
          executions += 1;
          return [];
        },
      });
      assert.equal(result.submission.classification, classification);
      assert.equal(result.transport_attempts, 1);
      assert.equal(executions, 0);
      const frozen = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(typeof frozen.submission.raw_response, 'string');
      assert.equal(frozen.submission.normalized_sql, null);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight and assigned slot gate precede any model request', async () => {
  const dir = privateDir();
  try {
    let calls = 0;
    const denied = await screen.runScreen({
      ...mockOptions(path.join(dir, 'preflight.json'), async () => {
        calls += 1;
        return response(sql);
      }),
      preflight: async () => {
        assert.equal(fs.statSync(path.join(dir, 'preflight.json')).mode & 0o777, 0o600);
        throw new Error('Docker unavailable');
      },
    });
    assert.equal(calls, 0);
    assert.equal(denied.transport_attempts, 0);
    assert.equal(denied.score.classification, 'executor_fail');
    await assert.rejects(
      screen.runScreen({ instance: 'a', output: path.join(dir, 'live.json') }),
      /assigned Cloudflare slot/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cloudflare configuration accepts only the exact account AI v1 API endpoint', () => {
  const accepted = screen.cloudflareConfig({
    CLOUDFLARE_OPENAI_BASE_URL: `${cloudflareEndpoint}/`,
    CLOUDFLARE_API_KEY: 'mock',
  });
  assert.equal(accepted.endpoint, cloudflareEndpoint);
  assert.equal(accepted.endpointSha256, sha256(cloudflareEndpoint));
  for (const endpoint of [
    cloudflareEndpoint.replace('https:', 'http:'),
    cloudflareEndpoint.replace('api.cloudflare.com', 'evil.example'),
    cloudflareEndpoint.replace('api.cloudflare.com', 'api.cloudflare.com.evil.example'),
    cloudflareEndpoint.replace('/ai/v1', '/ai/v2'),
    cloudflareEndpoint.replace('a'.repeat(32), 'not-an-account-id'),
    cloudflareEndpoint.replace('api.cloudflare.com', 'api.cloudflare.com:8443'),
    cloudflareEndpoint.replace('https://', 'https://user:password@'),
    `${cloudflareEndpoint}?redirect=evil`,
    `${cloudflareEndpoint}#fragment`,
  ]) {
    assert.throws(
      () =>
        screen.cloudflareConfig({
          CLOUDFLARE_OPENAI_BASE_URL: endpoint,
          CLOUDFLARE_API_KEY: 'mock',
        }),
      /Cloudflare endpoint/,
      endpoint,
    );
  }
});

test('live mode rejects injection hooks before reserving output or making a request', async () => {
  const dir = privateDir();
  try {
    let hookCalls = 0;
    for (const [name, value] of Object.entries({
      preflight: async () => {
        hookCalls += 1;
        return {};
      },
      execute: async () => {
        hookCalls += 1;
        return [];
      },
      request: async () => {
        hookCalls += 1;
        return response(sql);
      },
      pace: async () => {
        hookCalls += 1;
      },
    })) {
      const output = path.join(dir, `${name}.json`);
      await assert.rejects(
        screen.runScreen({
          instance: 'a',
          slotAssigned: true,
          output,
          env: {},
          [name]: value,
        }),
        /live screen may not override/,
        name,
      );
      assert.equal(fs.existsSync(output), false, name);
    }
    assert.equal(hookCalls, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('private output rejects either checkout and existing files before any request', async () => {
  let calls = 0;
  for (const output of [
    path.join(repoRoot, 'blocked-v12.json'),
    path.join(checkoutRoot, 'blocked-v12.json'),
  ]) {
    await assert.rejects(
      screen.runScreen(
        mockOptions(output, async () => {
          calls += 1;
          return response(sql);
        }),
      ),
      /private output must be outside/,
    );
  }
  const dir = privateDir();
  try {
    const output = path.join(dir, 'existing.json');
    fs.writeFileSync(output, 'keep');
    await assert.rejects(
      screen.runScreen(
        mockOptions(output, async () => {
          calls += 1;
          return response(sql);
        }),
      ),
      /EEXIST/,
    );
    assert.equal(fs.readFileSync(output, 'utf8'), 'keep');
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one no-cache HTTPS request uses the exact frozen body and one attempt', async () => {
  const dir = privateDir();
  try {
    let calls = 0;
    let gap = null;
    const result = await screen.runScreen({
      mock: true,
      instance: 'b',
      output: path.join(dir, 'result.json'),
      preflight: async () => ({}),
      pace: async (ms) => {
        gap = ms;
      },
      request: async (url, init) => {
        calls += 1;
        assert.equal(url, 'https://mock.invalid/v1/chat/completions');
        assert.equal(init.headers['cf-aig-skip-cache'], 'true');
        assert.equal(init.method, 'POST');
        assert.equal(init.body, manifestTools.verifyManifest(manifest).b.requestBodyJson);
        assert.deepEqual(
          (({ model, temperature, reasoning_effort, max_tokens, stream }) => ({
            model,
            temperature,
            reasoning_effort,
            max_tokens,
            stream,
          }))(JSON.parse(init.body)),
          {
            model: screen.MODEL_ID,
            temperature: 0,
            reasoning_effort: 'low',
            max_tokens: 16384,
            stream: false,
          },
        );
        return response(sql);
      },
      execute: async ({ batches }) => batches.map(() => []),
    });
    assert.equal(calls, 1);
    assert.equal(gap, 5000);
    assert.equal(result.transport_attempts, 1);
    assert.equal(result.endpoint_sha256, sha256(config.endpoint));
    assert.equal(result.score.projected_controls.total, 16);
    assert.equal(fs.statSync(path.join(dir, 'result.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('transport failure has no retry', async () => {
  const dir = privateDir();
  try {
    let calls = 0;
    const result = await screen.runScreen(
      mockOptions(path.join(dir, 'result.json'), async () => {
        calls += 1;
        throw new Error('connection lost');
      }),
    );
    assert.equal(calls, 1);
    assert.equal(result.transport_attempts, 1);
    assert.equal(result.submission.classification, 'provider_error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('raw response and normalized SQL are frozen privately before the pinned executor runs', async () => {
  const dir = privateDir();
  try {
    const output = path.join(dir, 'result.json');
    let calls = 0;
    let executions = 0;
    const secretSql = '```sql\n  SELECT grant_id FROM grants WHERE 0  \n```';
    const result = await screen.runScreen({
      ...mockOptions(output, async () => {
        calls += 1;
        return response(secretSql);
      }),
      execute: async ({ sql: submitted, batches }) => {
        executions += 1;
        assert.equal(submitted, sql);
        assert.equal(batches.length, executions === 1 ? 36 : 16);
        const frozen = JSON.parse(fs.readFileSync(output, 'utf8'));
        assert.equal(frozen.score, null);
        assert.equal(frozen.submission.normalized_sql, sql);
        assert.match(frozen.submission.raw_response, /```sql/);
        assert.match(frozen.submission.raw_response_sha256, /^[a-f0-9]{64}$/);
        assert.match(frozen.submission.normalized_sql_sha256, /^[a-f0-9]{64}$/);
        return batches.map(() => []);
      },
    });
    assert.equal(calls, 1);
    assert.equal(executions, 2);
    assert.equal(result.score.classification, 'model_fail');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the screen never writes model SQL to stdout or stderr', async () => {
  const dir = privateDir();
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const written = [];
  try {
    process.stdout.write = (value) => {
      written.push(String(value));
      return true;
    };
    process.stderr.write = (value) => {
      written.push(String(value));
      return true;
    };
    await screen.runScreen({
      ...mockOptions(path.join(dir, 'result.json'), async () =>
        response('SELECT secret_marker FROM grants'),
      ),
      execute: async ({ batches }) => batches.map(() => []),
    });
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(
    written.some((line) => line.includes('secret_marker')),
    false,
  );
});

test('host process never imports SQLite to execute model output', () => {
  const source = fs.readFileSync(path.join(here, 'screen.mjs'), 'utf8');
  assert.equal(source.includes('node:sqlite'), false);
  assert.equal(source.includes('executeSqlCorpus'), true);
  assert.equal(source.includes('preflightSqlExecutor'), true);
});
