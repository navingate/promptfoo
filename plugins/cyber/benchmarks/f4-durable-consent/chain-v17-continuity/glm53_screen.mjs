#!/usr/bin/env node
// Fixed, one-attempt Cloudflare GLM-5.3 development screen for the frozen F4 v17 cases.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { produceContinuity } from './continuity.mjs';
import { parsePlan, renderOneShot, scoreOneShot } from './oneshot.mjs';

export const MODEL_ID = '@cf/zai-org/glm-5.3';
const SETTINGS = Object.freeze({
  temperature: 0,
  max_completion_tokens: 16384,
  reasoning_effort: 'max',
  stream: false,
});
const CASES = Object.freeze([
  {
    profile: 'both-live',
    seed: 85117,
    prompt_sha256: '85f1a6dbb90e792bafc43503af289b5ae78e77686ee28b4dbe96b2064019e8d7',
  },
  {
    profile: 'both-live',
    seed: 85118,
    prompt_sha256: '5f0670ed89f40be4400d769a13ddcc35d16eec7c35d7f77c0df213383fec416b',
  },
  {
    profile: 'session-only',
    seed: 85129,
    prompt_sha256: 'a4060732e47307ccf18f1489f8a1584d32a43a4ca6e3c4bd48ce5908fcaeac9e',
  },
  {
    profile: 'benign-survivor',
    seed: 85141,
    prompt_sha256: 'f82fa1d25d9192ecc2a7fd7b09f41d647553c4d11f231a82bedb1cc3d6af0bdb',
  },
]);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function cloudflareConfig(env = process.env) {
  const base = env.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '');
  const apiKey = env.CLOUDFLARE_API_KEY;
  if (!base || !apiKey) {
    throw new Error('Cloudflare endpoint and API token required');
  }
  const url = new URL(base);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.cloudflare.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Cloudflare endpoint must be an HTTPS api.cloudflare.com path');
  }
  return { endpoint: `${base}/chat/completions`, apiKey, endpoint_id: sha256(base).slice(0, 16) };
}

export function buildRequest(prompt, config) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      'cf-aig-skip-cache': 'true',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages: [{ role: 'user', content: prompt }],
      ...SETTINGS,
    }),
    signal: AbortSignal.timeout(180000),
  };
}

function writePrivate(file, content) {
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
}

/** One planned request; every transport or model failure remains a separate result. */
export async function runCase({
  index,
  env = process.env,
  // biome-ignore lint/style/noRestrictedGlobals: standalone diagnostic uses an injectable request without the core build
  request = fetch,
  outputDir = process.env.F4_GLM_EVIDENCE_DIR ?? os.tmpdir(),
}) {
  if (!Number.isInteger(index) || index < 0 || index >= CASES.length) {
    throw new Error('case index must be 0..3');
  }
  const selected = CASES[index];
  const { episode, key } = produceContinuity(selected);
  const prompt = renderOneShot(episode);
  const promptSha = sha256(prompt);
  if (promptSha !== selected.prompt_sha256) {
    throw new Error('frozen prompt digest mismatch');
  }
  const config = cloudflareConfig(env);
  if (
    prompt.includes(config.apiKey) ||
    prompt.includes('/Users/') ||
    prompt.includes('CLOUDFLARE_API_KEY') ||
    prompt.includes('.env')
  ) {
    throw new Error('model prompt contains a local credential or path marker');
  }
  const prefix = path.join(outputDir, `f4-v17-glm53-e${index}`);
  const paths = {
    attempt: `${prefix}.attempt.json`,
    raw: `${prefix}.raw.json`,
    response: `${prefix}.response.txt`,
    result: `${prefix}.result.json`,
  };
  if (Object.values(paths).some((file) => fs.existsSync(file))) {
    throw new Error('case artifact exists; no retry or overwrite');
  }
  writePrivate(
    paths.attempt,
    `${JSON.stringify({
      case: index,
      profile: selected.profile,
      seed: selected.seed,
      model: MODEL_ID,
      settings: SETTINGS,
      endpoint_host: 'api.cloudflare.com',
      endpoint_id: config.endpoint_id,
      prompt_sha256: promptSha,
      requested_at: new Date().toISOString(),
    })}\n`,
  );
  const result = {
    case: index,
    profile: selected.profile,
    seed: selected.seed,
    model: MODEL_ID,
    endpoint_id: config.endpoint_id,
    settings: SETTINGS,
    prompt_sha256: promptSha,
    status: 'provider_error',
    reason: null,
    raw_sha256: null,
    response_sha256: null,
    finish_reason: null,
    usage: null,
    score: null,
  };
  let response;
  try {
    response = await request(config.endpoint, buildRequest(prompt, config));
  } catch (error) {
    result.reason = error?.name ?? 'transport-error';
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!response.ok) {
    result.reason = `http_${response.status}`;
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    result.reason = 'invalid-provider-json';
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const raw = `${JSON.stringify(body)}\n`;
  if (raw.includes(config.apiKey)) {
    result.reason = 'credential-reflected-in-provider-response';
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  writePrivate(paths.raw, raw);
  result.raw_sha256 = sha256(raw);
  result.usage = body.usage ?? null;
  if (body.model !== MODEL_ID) {
    result.reason = 'served-model-echo-mismatch';
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const choice = body.choices?.[0];
  result.finish_reason = choice?.finish_reason ?? null;
  const content = choice?.message?.content;
  if (choice?.finish_reason !== 'stop' || typeof content !== 'string') {
    result.status = 'format_error';
    result.reason = 'incomplete-or-missing-content';
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  writePrivate(paths.response, content);
  result.response_sha256 = sha256(content);
  try {
    parsePlan(content);
  } catch (error) {
    result.status = 'format_error';
    result.reason = error.message;
    writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  try {
    result.score = scoreOneShot(episode, key, content);
    result.status = 'scored';
  } catch (error) {
    result.status = 'runner_error';
    result.reason = error.message;
  }
  writePrivate(paths.result, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = Number(process.argv[2]);
  runCase({ index })
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({
          case: result.case,
          status: result.status,
          exact: result.score?.exact ?? null,
          reason: result.reason,
          raw_sha256: result.raw_sha256,
          response_sha256: result.response_sha256,
        })}\n`,
      );
      if (result.status !== 'scored') {
        process.exitCode = 2;
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 3;
    });
}
