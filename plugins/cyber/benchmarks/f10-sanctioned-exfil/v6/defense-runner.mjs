#!/usr/bin/env node
// One frozen producer batch per seed. Raw model output goes only to an explicit local path.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFENSE_PROMPT, referenceDefense, scoreDefense } from '../v3/defense.mjs';
import { REQUEST_WALL_MS, RETRY_DELAYS_MS, requestChat } from '../v5/transport.mjs';
import { loadBatch, serializeObservation } from './capture-consumer.mjs';
import { CAPTURE_SEEDS } from './capture-producer.mjs';

export const SCREEN_WALL_MS = 1200000;
const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const worktreeRoot = path.resolve(evidenceDir, '../../../../../..');
const marker = `${path.sep}.worktrees${path.sep}`;
const markerIndex = worktreeRoot.indexOf(marker);
const checkoutRoot = markerIndex < 0 ? worktreeRoot : worktreeRoot.slice(0, markerIndex);

export function selectApiKey(env) {
  return env.CYBER_API_KEY || env.AWS_API_KEY;
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function assertSafeOutputPath(outputFile) {
  const absolute = path.resolve(outputFile);
  const parent = fs.realpathSync(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (within(checkoutRoot, resolved) || within(worktreeRoot, resolved)) {
    throw new Error('raw defense output must be outside the repository');
  }
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error('raw defense output must not be a symlink');
  }
  return resolved;
}

export function writeOutput(outputFile, value) {
  const safe = assertSafeOutputPath(outputFile);
  const temporary = `${safe}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, safe);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

function observationManifest() {
  const bytes = fs.readFileSync(path.join(evidenceDir, 'observation-manifest.json'));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema_version, 'f10-observation-manifest-v1');
  assert.equal(manifest.system_prompt_sha256, hash(DEFENSE_PROMPT));
  assert.deepEqual(
    manifest.instances.map((instance) => instance.seed),
    CAPTURE_SEEDS,
  );
  return manifest;
}

export function parseLabels(raw) {
  const stripped = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .trim();
  const fence = stripped.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fence ? fence[1] : stripped).trim();
  try {
    const labels = JSON.parse(candidate);
    return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : null;
  } catch {
    return null;
  }
}

export async function runDefenseCase(seed, args, cfg, request = requestChat) {
  if (!CAPTURE_SEEDS.includes(seed)) {
    throw new Error('unknown vendored F10 defense seed');
  }
  const manifest = observationManifest();
  const batch = loadBatch(seed);
  const staged = serializeObservation(batch);
  const instance = manifest.instances.find((entry) => entry.seed === seed);
  assert.equal(hash(staged), instance.user_message_sha256);
  assert.deepEqual(
    batch.captures.map((capture) => capture.capture_id),
    instance.capture_ids,
  );
  assert.equal(batch.flows.length, instance.flow_count);
  if (args.mock) {
    const score = scoreDefense(batch, referenceDefense(batch));
    return { seed, classification: score.exact ? 'pass' : 'invalid_run', score, parsed: true };
  }
  const messages = [
    { role: 'system', content: DEFENSE_PROMPT },
    { role: 'user', content: staged },
  ];
  const transcript = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (Date.now() >= cfg.screenDeadlineMs) {
      return { seed, classification: 'provider_error', reason: 'screen-wall-limit', transcript };
    }
    const response = await request(messages, cfg);
    if (response.kind !== 'ok') {
      return {
        seed,
        classification: response.kind,
        reason: response.reason,
        transport: response.transport,
        transcript,
      };
    }
    const labels = response.finish_reason === 'length' ? null : parseLabels(response.text);
    const score = scoreDefense(batch, labels);
    transcript.push({
      raw: response.text,
      served_model: response.served_model,
      usage: response.usage,
      transport: response.transport,
      finish_reason: response.finish_reason,
      score,
    });
    if (score.valid) {
      return {
        seed,
        classification: score.exact ? 'pass' : 'model_fail',
        reason: score.exact ? undefined : 'wrong-labels',
        score,
        parsed: true,
        transcript,
      };
    }
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: response.text });
      messages.push({
        role: 'user',
        content: `Return only a JSON object with exactly these flow_id keys and one of the four labels for each: ${batch.flows.map((flow) => flow.flow_id).join(', ')}`,
      });
    }
  }
  return { seed, classification: 'model_fail', reason: 'off-grammar', parsed: false, transcript };
}

function parseArgs(argv) {
  const args = { seeds: CAPTURE_SEEDS, maxTokens: 8192, timeoutMs: 300000, mock: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mock-reference') {
      args.mock = true;
    } else if (flag === '--resume') {
      args.resume = true;
    } else if (['--seeds', '--output', '--max-tokens', '--timeout-ms'].includes(flag)) {
      const value = argv[++index];
      if (value === undefined) {
        throw new Error(`missing value for ${flag}`);
      }
      if (flag === '--seeds') {
        args.seeds = value.split(',').map(Number);
      } else if (flag === '--output') {
        args.output = value;
      } else if (flag === '--max-tokens') {
        args.maxTokens = Number(value);
      } else {
        args.timeoutMs = Number(value);
      }
    } else {
      throw new Error(`unknown option ${flag}`);
    }
  }
  if (
    args.seeds.length === 0 ||
    new Set(args.seeds).size !== args.seeds.length ||
    args.seeds.some((seed) => !CAPTURE_SEEDS.includes(seed)) ||
    !Number.isInteger(args.maxTokens) ||
    args.maxTokens < 1 ||
    !Number.isInteger(args.timeoutMs) ||
    args.timeoutMs < 1
  ) {
    throw new Error('invalid defense seeds or request budget');
  }
  if (args.resume && !args.output) {
    throw new Error('--resume requires --output');
  }
  if (args.output) {
    assertSafeOutputPath(args.output);
  }
  return args;
}

function summarize(results, args, cfg) {
  const requests = results.flatMap((result) => [
    ...(result.transcript ?? []).map((turn) => turn.transport).filter(Boolean),
    ...(result.transport ? [result.transport] : []),
  ]);
  return {
    mode: 'defense',
    model: args.mock ? 'reference' : cfg.model,
    endpoint_id: args.mock ? 'local-reference' : cfg.endpointId,
    total: results.length,
    pass: results.filter((result) => result.classification === 'pass').length,
    model_fail: results.filter((result) => result.classification === 'model_fail').length,
    provider_error: results.filter((result) => result.classification === 'provider_error').length,
    invalid_run: results.filter((result) => result.classification === 'invalid_run').length,
    off_grammar: results.filter((result) => result.reason === 'off-grammar').length,
    parsed_defense_batches: results.filter((result) => result.parsed === true).length,
    transport_retried_requests: requests.filter((request) => request.attempts > 1).length,
    transient_error_events: requests.reduce(
      (sum, request) => sum + request.transient_errors.length,
      0,
    ),
  };
}

function captureOutput(results, args, cfg) {
  return {
    summary: summarize(results, args, cfg),
    config: {
      seeds: args.seeds,
      max_tokens: cfg.maxTokens,
      timeout_ms: cfg.timeoutMs,
      concurrency: 1,
      temperature: 0,
      request_retry_delays_ms: RETRY_DELAYS_MS,
      request_wall_ms: REQUEST_WALL_MS,
      screen_wall_ms: SCREEN_WALL_MS,
      observation_manifest_sha256: hash(
        fs.readFileSync(path.join(evidenceDir, 'observation-manifest.json')),
      ),
    },
    results,
  };
}

function previousResults(args, cfg) {
  if (!args.resume) {
    if (args.output && fs.existsSync(args.output)) {
      throw new Error('raw defense output already exists; use --resume to retain prior outcomes');
    }
    return [];
  }
  const prior = JSON.parse(fs.readFileSync(assertSafeOutputPath(args.output), 'utf8'));
  const expected = captureOutput([], args, cfg);
  assert.deepEqual(prior.config, expected.config, 'resume config changed');
  assert.equal(prior.summary.model, expected.summary.model, 'resume model changed');
  assert.equal(prior.summary.endpoint_id, expected.summary.endpoint_id, 'resume endpoint changed');
  assert.ok(prior.results.length <= args.seeds.length, 'too many prior cases');
  for (let index = 0; index < prior.results.length; index += 1) {
    assert.equal(prior.results[index].seed, args.seeds[index], 'resume seed sequence changed');
  }
  assert.deepEqual(prior.summary, summarize(prior.results, args, cfg), 'resume summary mismatch');
  return prior.results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = {
    baseUrl: process.env.CYBER_SUT_ENDPOINT,
    endpointId: process.env.CYBER_ENDPOINT_ID,
    model: process.env.CYBER_MODEL,
    apiKey: selectApiKey(process.env),
    maxTokens: args.maxTokens,
    timeoutMs: args.timeoutMs,
    screenDeadlineMs: Date.now() + SCREEN_WALL_MS,
  };
  if (!args.mock && (!cfg.baseUrl || !cfg.endpointId || !cfg.model || !cfg.apiKey)) {
    throw new Error(
      'set CYBER_SUT_ENDPOINT, CYBER_ENDPOINT_ID, CYBER_MODEL, and a gateway API key',
    );
  }
  const results = previousResults(args, cfg);
  for (const seed of args.seeds.slice(results.length)) {
    const result = await runDefenseCase(seed, args, cfg);
    results.push(result);
    if (args.output) {
      writeOutput(args.output, captureOutput(results, args, cfg));
    }
    process.stdout.write(
      `defense ${seed}: ${result.classification}${result.reason ? ` (${result.reason})` : ''}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(summarize(results, args, cfg))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
