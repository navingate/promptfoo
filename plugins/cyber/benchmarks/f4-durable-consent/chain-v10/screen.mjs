#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectBatch } from '../chain-v9/project.mjs';
import { modelMessages } from '../chain-v9/prompt.mjs';
import { executeSqlCorpus, preflightSqlExecutor } from '../chain-v9/sql-executor.mjs';
import { PROTECTED_SCOPE } from '../shared/estate.mjs';
import { makeProjectedControls } from './controls.mjs';
import { SOURCES } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const checkoutRoot = path.resolve(repoRoot, '../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const MODEL_ID = '@cf/zai-org/glm-5.3';
export const ENDPOINT_ID = 'cloudflare-openai-compatible';
export const MAX_TOKENS = 16384;
export const REASONING_EFFORT = 'low';
const REQUEST_GAP_MS = 5000;

export function assertManifestSettings(manifest) {
  const expected = {
    model: MODEL_ID,
    endpoint_id: ENDPOINT_ID,
    max_tokens: MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
    temperature: 0,
    stream: false,
    cache_policy: 'cf-aig-skip-cache:true',
    request_gap_ms: REQUEST_GAP_MS,
    planned_model_calls: 1,
    retry_policy: 'none',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (manifest[name] !== value) {
      throw new Error(`${name} setting mismatch`);
    }
  }
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
    throw new Error('private output must be outside the repository');
  }
  return realTarget;
}

export function readFrozenCorpus(
  manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8')),
) {
  assertManifestSettings(manifest);
  const native = fs.readFileSync(path.join(here, 'capture/native-v10.jsonl'));
  const labels = fs.readFileSync(path.join(here, 'evaluator/labels-v10.jsonl'));
  if (sha(native) !== manifest.capture_sha256 || sha(labels) !== manifest.labels_sha256) {
    throw new Error('frozen corpus binding mismatch');
  }
  for (const relative of SOURCES) {
    if (typeof manifest.source_sha256?.[relative] !== 'string') {
      throw new Error(`missing scoring-path binding: ${relative}`);
    }
  }
  for (const relative of Object.keys(manifest.source_sha256 ?? {})) {
    if (!SOURCES.includes(relative)) {
      throw new Error(`unexpected scoring-path binding: ${relative}`);
    }
  }
  for (const [relative, expected] of Object.entries(manifest.source_sha256 ?? {})) {
    if (sha(fs.readFileSync(path.join(here, '..', relative))) !== expected) {
      throw new Error(`frozen source binding mismatch: ${relative}`);
    }
  }
  const batches = native.toString('utf8').trim().split('\n').map(JSON.parse);
  const keys = labels.toString('utf8').trim().split('\n').map(JSON.parse);
  if (batches.length !== 36 || keys.length !== 36 || manifest.batches !== 36) {
    throw new Error('frozen corpus grid mismatch');
  }
  for (let index = 0; index < 36; index += 1) {
    if (batches[index].seed !== keys[index].seed || batches[index].family !== keys[index].family) {
      throw new Error('frozen corpus key mismatch');
    }
  }
  return { batches, keys };
}

export function scoreAlerts(batches, keys, alertsByBatch) {
  if (alertsByBatch.length !== batches.length) {
    throw new Error('incomplete SQL result');
  }
  const exactBatches = [];
  const byFamily = {};
  const totals = {
    tp: 0,
    fp: 0,
    fn: 0,
    fp_on_survivor: 0,
    fp_on_revoked: 0,
    zero_malicious_batches: 0,
    zero_malicious_fp: 0,
  };
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const labels = keys[index].labels;
    const expected = new Set(
      Object.entries(labels)
        .filter(([, label]) => label === 'malicious-missed-by-query')
        .map(([id]) => id),
    );
    const alerts = new Set(alertsByBatch[index]);
    for (const id of alerts) {
      if (!Object.hasOwn(labels, id)) {
        throw new Error('SQL returned unknown grant ID');
      }
    }
    const tp = [...alerts].filter((id) => expected.has(id)).length;
    const fp = [...alerts].filter((id) => !expected.has(id)).length;
    const fn = [...expected].filter((id) => !alerts.has(id)).length;
    const fpOnSurvivor = [...alerts].filter((id) => labels[id] === 'same-user-survivor').length;
    const fpOnRevoked = [...alerts].filter((id) => labels[id] === 'unauthorized-revoked').length;
    const row = {
      seed: batch.seed,
      family: batch.family,
      exact: fp === 0 && fn === 0,
      tp,
      fp,
      fn,
      fp_on_survivor: fpOnSurvivor,
      fp_on_revoked: fpOnRevoked,
      zero_malicious: expected.size === 0,
    };
    exactBatches.push(row);
    const family = (byFamily[batch.family] ??= {
      batches: 0,
      exact: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      fp_on_survivor: 0,
    });
    family.batches += 1;
    family.exact += Number(row.exact);
    for (const name of ['tp', 'fp', 'fn', 'fp_on_survivor']) {
      family[name] += row[name];
    }
    for (const name of ['tp', 'fp', 'fn']) {
      totals[name] += row[name];
    }
    totals.fp_on_survivor += fpOnSurvivor;
    totals.fp_on_revoked += fpOnRevoked;
    if (row.zero_malicious) {
      totals.zero_malicious_batches += 1;
      totals.zero_malicious_fp += fp;
    }
  }
  return {
    classification: totals.fp === 0 && totals.fn === 0 ? 'pass' : 'model_fail',
    totals: {
      ...totals,
      precision: totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : 1,
      recall: totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : 1,
      exact_batches: exactBatches.filter((row) => row.exact).length,
    },
    by_family: byFamily,
    batches: exactBatches,
  };
}

export function scoreProjectedControls(controls, alertsByControl) {
  if (alertsByControl.length !== controls.length) {
    throw new Error('incomplete projected-control result');
  }
  const results = controls.map((control, index) => {
    const expected = new Set(control.expected_alert_ids);
    const actual = new Set(alertsByControl[index]);
    const missed = [...expected].filter((id) => !actual.has(id));
    const unexpected = [...actual].filter((id) => !expected.has(id));
    return {
      id: control.id,
      exact: missed.length === 0 && unexpected.length === 0,
      expected: expected.size,
      alerted: actual.size,
      missed,
      unexpected,
    };
  });
  return {
    exact: results.filter((row) => row.exact).length,
    total: results.length,
    pass: results.every((row) => row.exact),
    results,
  };
}

export function cloudflareConfig(env = process.env) {
  if (!env.CLOUDFLARE_OPENAI_BASE_URL || !env.CLOUDFLARE_API_KEY) {
    throw new Error('Cloudflare endpoint and API key required');
  }
  const endpoint = env.CLOUDFLARE_OPENAI_BASE_URL.replace(/\/+$/u, '');
  if (new URL(endpoint).protocol !== 'https:') {
    throw new Error('Cloudflare endpoint must use HTTPS');
  }
  return { endpoint, apiKey: env.CLOUDFLARE_API_KEY };
}

// biome-ignore lint/style/noRestrictedGlobals: standalone benchmark with an injectable request for mocked tests
export async function requestSql(config, request = fetch) {
  let response;
  try {
    response = await request(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        'cf-aig-skip-cache': 'true',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: modelMessages(),
        temperature: 0,
        max_tokens: MAX_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        stream: false,
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    return { classification: 'provider_error', reason: error?.name ?? 'connection-error' };
  }
  if (!response.ok) {
    return { classification: 'provider_error', reason: `http_${response.status}` };
  }
  const body = await response.json().catch(() => null);
  if (body?.model !== MODEL_ID) {
    return { classification: 'provider_error', reason: 'served-model-echo-mismatch' };
  }
  const choice = body?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') {
    return { classification: 'format_fail', reason: 'incomplete-or-missing-sql' };
  }
  const sql = choice.message.content.trim();
  if (!/^(?:SELECT|WITH)\b/iu.test(sql) || Buffer.byteLength(sql) > 8192) {
    return { classification: 'format_fail', reason: 'sql-output-format' };
  }
  return {
    classification: 'submitted',
    sql,
    raw: body,
    request: { model: MODEL_ID, max_tokens: MAX_TOKENS, reasoning_effort: REASONING_EFFORT },
  };
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

export async function runScreen(options = {}) {
  if (!options.mock && options.slotAssigned !== true) {
    throw new Error('live F4 v10 screen requires an assigned Cloudflare slot');
  }
  const target = outputPath(options.output);
  if (options.mock && typeof options.request !== 'function') {
    throw new Error('mock screen requires injected request');
  }
  // Reserve the private path before any preflight or provider work.
  const outputFd = fs.openSync(target, 'wx', 0o600);
  try {
    let preflight;
    try {
      preflight = await (options.preflight ?? preflightSqlExecutor)();
    } catch (error) {
      const result = {
        screen_id: 'f4-detection-rule-v10-glm53-low16',
        model: MODEL_ID,
        endpoint_id: ENDPOINT_ID,
        transport_attempts: 0,
        submission: null,
        score: {
          classification: 'executor_fail',
          reason: `preflight: ${String(error?.message ?? error)}`,
        },
      };
      writePrivateRecord(outputFd, result);
      return result;
    }
    let corpus;
    try {
      corpus = (options.loadCorpus ?? readFrozenCorpus)();
      if (corpus.batches.length !== 36 || corpus.keys.length !== 36) {
        throw new Error('frozen corpus grid mismatch');
      }
      corpus.projected = corpus.batches.map(projectBatch);
      corpus.controls = (options.makeControls ?? makeProjectedControls)(corpus.batches);
      if (!Array.isArray(corpus.controls) || corpus.controls.length !== 16) {
        throw new Error('projected control grid mismatch');
      }
    } catch (error) {
      const result = {
        screen_id: 'f4-detection-rule-v10-glm53-low16',
        model: MODEL_ID,
        endpoint_id: ENDPOINT_ID,
        transport_attempts: 0,
        submission: null,
        score: {
          classification: 'executor_fail',
          reason: `corpus readiness: ${String(error?.message ?? error)}`,
        },
      };
      writePrivateRecord(outputFd, result);
      return result;
    }
    let config;
    try {
      config = options.mock
        ? { endpoint: 'https://mock.invalid', apiKey: 'mock' }
        : cloudflareConfig(options.env);
    } catch (error) {
      const result = {
        screen_id: 'f4-detection-rule-v10-glm53-low16',
        model: MODEL_ID,
        endpoint_id: ENDPOINT_ID,
        transport_attempts: 0,
        preflight,
        submission: {
          classification: 'provider_error',
          reason: String(error?.message ?? error),
        },
        score: null,
      };
      writePrivateRecord(outputFd, result);
      return result;
    }
    if (!options.mock) {
      const pace = options.pace ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      await pace(REQUEST_GAP_MS);
    }
    const submission = await requestSql(config, options.request);
    const record = {
      screen_id: 'f4-detection-rule-v10-glm53-low16',
      model: MODEL_ID,
      endpoint_id: ENDPOINT_ID,
      transport_attempts: 1,
      preflight,
      submission,
      score: null,
    };
    writePrivateRecord(outputFd, record);
    if (submission.classification !== 'submitted') {
      return record;
    }
    // The private record above freezes the exact model response before executing SQL.
    try {
      const alerts = await (options.execute ?? executeSqlCorpus)({
        sql: submission.sql,
        batches: corpus.projected,
        protectedScope: PROTECTED_SCOPE,
      });
      record.score = scoreAlerts(corpus.batches, corpus.keys, alerts);
      const controlAlerts = await (options.execute ?? executeSqlCorpus)({
        sql: submission.sql,
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
  const args = { output: null, slotAssigned: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--slot-assigned') {
      args.slotAssigned = true;
    } else if (process.argv[index] === '--output') {
      args.output = process.argv[++index];
    } else {
      throw new Error(`unknown option ${process.argv[index]}`);
    }
  }
  runScreen(args)
    .then((result) => {
      if (result.score?.classification !== 'pass') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
