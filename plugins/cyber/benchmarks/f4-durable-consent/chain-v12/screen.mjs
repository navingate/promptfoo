#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeSqlCorpus, preflightSqlExecutor } from '../chain-v9/sql-executor.mjs';
import { scoreAlerts, scoreProjectedControls } from '../chain-v10/screen.mjs';
import { PROTECTED_SCOPE } from '../shared/estate.mjs';
import { INSTANCE_CONFIGS } from './freeze.mjs';
import { verifyManifest } from './manifest.mjs';
import { REQUEST_SETTINGS } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const checkoutRoot = path.resolve(repoRoot, '../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const REQUEST_GAP_MS = 5000;
export const MODEL_ID = REQUEST_SETTINGS.model;
export const ENDPOINT_ID = 'cloudflare-openai-compatible';

export function normalizeSql(content) {
  if (typeof content !== 'string') {
    throw new Error('SQL format invalid');
  }
  let sql = content.trim();
  if (sql.startsWith('```')) {
    const match = /^```sql\r?\n([\s\S]*?)\r?\n```$/u.exec(sql);
    if (!match) {
      throw new Error('SQL format invalid');
    }
    sql = match[1].trim();
  }
  if (sql.includes('```') || !/^(?:SELECT|WITH)\b/iu.test(sql) || Buffer.byteLength(sql) > 8192) {
    throw new Error('SQL format invalid');
  }
  return sql;
}

function outputPath(value) {
  if (!value) {
    throw new Error('private --output is required');
  }
  const target = path.resolve(value);
  const realParent = fs.realpathSync(path.dirname(target));
  const realTarget = path.join(realParent, path.basename(target));
  if (
    [repoRoot, checkoutRoot].some(
      (root) => realTarget === root || realTarget.startsWith(`${root}${path.sep}`),
    )
  ) {
    throw new Error('private output must be outside the repository and worktree');
  }
  return realTarget;
}

function writePrivateRecord(fd, record) {
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  let written = 0;
  while (written < bytes.length) {
    const count = fs.writeSync(fd, bytes, written, bytes.length - written, written);
    if (count < 1) {
      throw new Error('private output write failed');
    }
    written += count;
  }
  fs.ftruncateSync(fd, bytes.length);
  fs.fsyncSync(fd);
}

export function cloudflareConfig(env = process.env) {
  if (!env.CLOUDFLARE_OPENAI_BASE_URL || !env.CLOUDFLARE_API_KEY) {
    throw new Error('Cloudflare endpoint and API key required');
  }
  let parsed;
  try {
    parsed = new URL(env.CLOUDFLARE_OPENAI_BASE_URL);
  } catch {
    throw new Error('Cloudflare endpoint must be the HTTPS account AI v1 API URL');
  }
  const endpointPath = parsed.pathname.replace(/\/+$/u, '');
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'api.cloudflare.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/v1$/iu.test(endpointPath)
  ) {
    throw new Error('Cloudflare endpoint must be the HTTPS account AI v1 API URL');
  }
  const endpoint = `${parsed.origin}${endpointPath}`;
  return { endpoint, endpointSha256: sha256(endpoint), apiKey: env.CLOUDFLARE_API_KEY };
}

// biome-ignore lint/style/noRestrictedGlobals: standalone benchmark with an injectable request for mocked tests
export async function requestSql(config, requestBodyJson, request = fetch) {
  let response;
  try {
    response = await request(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        'cf-aig-skip-cache': 'true',
      },
      body: requestBodyJson,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    return {
      classification: 'provider_error',
      reason: error?.name ?? 'connection-error',
      raw_response: null,
      raw_response_sha256: null,
      normalized_sql: null,
      normalized_sql_sha256: null,
    };
  }
  let rawResponse;
  try {
    rawResponse = await response.text();
  } catch {
    return {
      classification: 'provider_error',
      reason: 'response-read-failed',
      raw_response: null,
      raw_response_sha256: null,
      normalized_sql: null,
      normalized_sql_sha256: null,
    };
  }
  const submitted = {
    raw_response: rawResponse,
    raw_response_sha256: sha256(rawResponse),
    normalized_sql: null,
    normalized_sql_sha256: null,
  };
  if (!response.ok) {
    return { classification: 'provider_error', reason: `http_${response.status}`, ...submitted };
  }
  let body;
  try {
    body = JSON.parse(rawResponse);
  } catch {
    return { classification: 'provider_error', reason: 'invalid-response-json', ...submitted };
  }
  if (body?.model !== MODEL_ID) {
    return { classification: 'provider_error', reason: 'served-model-echo-mismatch', ...submitted };
  }
  const choice = body?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') {
    return { classification: 'format_fail', reason: 'incomplete-or-missing-sql', ...submitted };
  }
  try {
    const sql = normalizeSql(choice.message.content);
    return {
      classification: 'submitted',
      ...submitted,
      normalized_sql: sql,
      normalized_sql_sha256: sha256(sql),
    };
  } catch {
    return { classification: 'format_fail', reason: 'sql-output-format', ...submitted };
  }
}

function baseRecord(instance, preflight = null) {
  return {
    screen_id: 'f4-detection-rule-v12-glm53-low16',
    instance,
    model: MODEL_ID,
    endpoint_id: ENDPOINT_ID,
    endpoint_sha256: null,
    transport_attempts: 0,
    preflight,
    submission: null,
    score: null,
  };
}

export async function runScreen(options = {}) {
  const mock = options.mock === true;
  if (!mock && options.slotAssigned !== true) {
    throw new Error('live F4 v12 screen requires an assigned Cloudflare slot');
  }
  const instance = options.instance;
  if (!Object.hasOwn(INSTANCE_CONFIGS, instance)) {
    throw new Error('one frozen v12 instance is required');
  }
  if (mock && typeof options.request !== 'function') {
    throw new Error('mock screen requires an injected request');
  }
  if (
    !mock &&
    ['manifest', 'preflight', 'execute', 'request', 'pace'].some((name) =>
      Object.hasOwn(options, name),
    )
  ) {
    throw new Error('live screen may not override the frozen executor or request');
  }
  const target = outputPath(options.output);
  const outputFd = fs.openSync(target, 'wx', 0o600);
  try {
    let preflight;
    try {
      preflight = await (mock
        ? (options.preflight ?? preflightSqlExecutor)
        : preflightSqlExecutor)();
    } catch {
      const record = baseRecord(instance);
      record.score = {
        classification: 'executor_fail',
        reason: 'preflight: pinned Linux Docker executor unavailable',
      };
      writePrivateRecord(outputFd, record);
      return record;
    }
    const record = baseRecord(instance, preflight);
    let corpus;
    let manifest;
    try {
      manifest =
        (mock ? options.manifest : null) ??
        JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
      corpus = verifyManifest(manifest)[instance];
      if (
        corpus.batches.length !== 36 ||
        corpus.keys.length !== 36 ||
        corpus.controls.length !== 16
      ) {
        throw new Error('frozen corpus grid binding mismatch');
      }
    } catch (error) {
      record.score = {
        classification: 'executor_fail',
        reason: `corpus readiness: ${String(error?.message ?? error)}`,
      };
      writePrivateRecord(outputFd, record);
      return record;
    }
    record.request = {
      model: MODEL_ID,
      temperature: REQUEST_SETTINGS.temperature,
      reasoning_effort: REQUEST_SETTINGS.reasoning_effort,
      max_tokens: REQUEST_SETTINGS.max_tokens,
      stream: REQUEST_SETTINGS.stream,
      cache_policy: 'cf-aig-skip-cache:true',
      request_gap_ms: REQUEST_GAP_MS,
      messages_sha256: manifest.instances[instance].messages_sha256,
      body_sha256: corpus.requestBodySha256,
    };
    let config;
    try {
      config = mock
        ? {
            endpoint: 'https://mock.invalid/v1',
            endpointSha256: sha256('https://mock.invalid/v1'),
            apiKey: 'mock',
          }
        : cloudflareConfig(options.env);
    } catch {
      record.submission = {
        classification: 'provider_error',
        reason: 'invalid Cloudflare configuration',
      };
      writePrivateRecord(outputFd, record);
      return record;
    }
    record.endpoint_sha256 = config.endpointSha256;
    if (!mock || options.pace) {
      const pace = mock ? options.pace : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await pace(REQUEST_GAP_MS);
    }
    record.transport_attempts = 1;
    record.submission = await requestSql(
      config,
      corpus.requestBodyJson,
      mock ? options.request : undefined,
    );
    // Persist the exact response and normalized SQL before any model SQL is executed.
    writePrivateRecord(outputFd, record);
    if (record.submission.classification !== 'submitted') {
      return record;
    }
    try {
      const executor = mock ? (options.execute ?? executeSqlCorpus) : executeSqlCorpus;
      const alerts = await executor({
        sql: record.submission.normalized_sql,
        batches: corpus.projected,
        protectedScope: PROTECTED_SCOPE,
      });
      record.score = scoreAlerts(corpus.batches, corpus.keys, alerts);
      const controlAlerts = await executor({
        sql: record.submission.normalized_sql,
        batches: corpus.controls.map((control) => control.tables),
        protectedScope: PROTECTED_SCOPE,
      });
      record.score.projected_controls = scoreProjectedControls(corpus.controls, controlAlerts);
      if (!record.score.projected_controls.pass) {
        record.score.classification = 'model_fail';
      }
    } catch (error) {
      record.score = { classification: 'executor_fail', reason: String(error?.message ?? error) };
    }
    writePrivateRecord(outputFd, record);
    return record;
  } finally {
    fs.closeSync(outputFd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = { output: null, instance: null, slotAssigned: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--slot-assigned') {
      args.slotAssigned = true;
    } else if (process.argv[index] === '--output') {
      args.output = process.argv[++index];
    } else if (process.argv[index] === '--instance') {
      args.instance = process.argv[++index];
    } else {
      throw new Error('unknown v12 screen option');
    }
  }
  runScreen(args)
    .then((result) => {
      if (!['pass', 'model_fail'].includes(result.score?.classification)) {
        process.exitCode = 1;
      }
    })
    .catch(() => {
      process.stderr.write('v12 screen failed; inspect the private record if one was reserved\n');
      process.exitCode = 1;
    });
}
