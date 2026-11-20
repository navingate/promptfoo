import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCase,
  corpus,
  referenceFromSerializedView,
  render,
  resolve,
  SYSTEM_PROMPT,
  score,
} from '../v10/chain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defense = path.dirname(here);
const root = path.resolve(defense, '../../../../../');
const evidence = path.join(here, 'evidence');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const fileSha = (file) => sha(fs.readFileSync(file));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const indices = corpus().map((_, index) => index);
const settings = Object.freeze({
  model: '@cf/zai-org/glm-5.3',
  stream: false,
  reasoning_effort: 'max',
  max_completion_tokens: 8192,
});

function promptFor(index) {
  const testCase = buildCase(corpus()[index]);
  return `${SYSTEM_PROMPT}\n\n${render(testCase)}\n\nDo not use tools. Answer the change request as the defender now.`;
}

function sourceHashes() {
  return Object.fromEntries(
    [
      ['v10', path.join(defense, 'v10/chain.mjs')],
      ['v6', path.join(defense, 'v6/chain.mjs')],
      ['v5', path.join(defense, 'v5/chain.mjs')],
      ['estate', path.join(defense, '../shared/estate.mjs')],
      ['protocol', path.join(here, 'PROTOCOL.md')],
      ['runner', path.join(here, 'run.mjs')],
    ].map(([name, file]) => [name, fileSha(file)]),
  );
}

function validateCorpus() {
  if (indices.length !== 36) {
    throw new Error('Corpus must contain 36 cells');
  }
  const counts = {};
  for (const index of indices) {
    const testCase = buildCase(corpus()[index]);
    const expected = resolve(testCase.view);
    const independent = referenceFromSerializedView(JSON.stringify(testCase.view));
    if (
      expected.length !== 4 ||
      JSON.stringify(expected) !== JSON.stringify(independent) ||
      expected.some((action) => action.target_resource === testCase.source.offense_target) ||
      !score(testCase, { actions: expected }).exact ||
      score(testCase, { actions: [] }).exact
    ) {
      throw new Error(`Invalid frozen case ${index}`);
    }
    counts[testCase.spec.variant] = (counts[testCase.spec.variant] ?? 0) + 1;
  }
  if (counts['missing-counterpart'] !== 18 || counts['present-counterpart'] !== 18) {
    throw new Error('Variant imbalance');
  }
  return counts;
}

function prepare() {
  if (fs.existsSync(evidence)) {
    throw new Error(`Evidence directory already exists: ${evidence}`);
  }
  const variants = validateCorpus();
  fs.mkdirSync(evidence, { recursive: true });
  const prompts = {};
  for (const index of indices) {
    const prompt = promptFor(index);
    const file = path.join(evidence, `case-${String(index).padStart(2, '0')}.prompt.txt`);
    fs.writeFileSync(file, prompt);
    prompts[index] = sha(prompt);
  }
  const freeze = {
    candidate_commit: '8298759aae8d3587713d38f57388ccca57c98344',
    model_settings: settings,
    endpoint_kind: 'Cloudflare Workers AI OpenAI-compatible REST',
    case_indices: indices,
    variants,
    source_sha256: sourceHashes(),
    prompt_sha256: prompts,
  };
  writeJson(path.join(evidence, 'freeze.json'), freeze);
  process.stdout.write(
    `Prepared and preregistered 36 cells; freeze_sha256=${fileSha(path.join(evidence, 'freeze.json'))}\n`,
  );
}

function verifyFreeze() {
  const freeze = readJson(path.join(evidence, 'freeze.json'));
  if (
    JSON.stringify(freeze.source_sha256) !== JSON.stringify(sourceHashes()) ||
    JSON.stringify(freeze.model_settings) !== JSON.stringify(settings) ||
    JSON.stringify(freeze.case_indices) !== JSON.stringify(indices) ||
    JSON.stringify(freeze.variants) !== JSON.stringify(validateCorpus())
  ) {
    throw new Error('Frozen source, settings, or corpus drift');
  }
  for (const index of indices) {
    const file = path.join(evidence, `case-${String(index).padStart(2, '0')}.prompt.txt`);
    if (
      fs.readFileSync(file, 'utf8') !== promptFor(index) ||
      fileSha(file) !== freeze.prompt_sha256[index]
    ) {
      throw new Error(`Frozen prompt drift at ${index}`);
    }
  }
  return freeze;
}

function credentials() {
  const env = { ...process.env };
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/u)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
      if (match && env[match[1]] === undefined) {
        env[match[1]] = match[2].replace(/^['"]|['"]$/gu, '');
      }
    }
  }
  const base = env.CLOUDFLARE_OPENAI_BASE_URL;
  const token = env.CLOUDFLARE_API_KEY;
  if (!base || !token) {
    throw new Error('Cloudflare endpoint or token is absent');
  }
  const url = new URL(`${base.replace(/\/$/u, '')}/chat/completions`);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.cloudflare.com' ||
    !url.pathname.endsWith('/ai/v1/chat/completions')
  ) {
    throw new Error('Cloudflare endpoint does not match the preregistered route');
  }
  return { url: url.href, token };
}

async function invoke(prompt) {
  const { url, token } = credentials();
  const started = Date.now();
  let response;
  try {
    // biome-ignore lint/style/noRestrictedGlobals: Standalone benchmark runner uses native Node fetch, outside the application proxy stack.
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    return {
      ok: false,
      error_type: error.name ?? 'network_error',
      duration_ms: Date.now() - started,
    };
  }
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      http_status: response.status,
      error_type: 'non_json_api_response',
      body_sha256: sha(body),
      duration_ms: Date.now() - started,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      http_status: response.status,
      error_type: parsed.errors?.[0]?.code ?? parsed.error?.code ?? 'http_error',
      body_sha256: sha(body),
      duration_ms: Date.now() - started,
    };
  }
  return {
    ok: true,
    http_status: response.status,
    body: parsed,
    body_sha256: sha(body),
    duration_ms: Date.now() - started,
  };
}

function extract(raw) {
  const body = raw.body;
  const content = body.choices?.[0]?.message?.content;
  return {
    response_model: body.model ?? null,
    finish_reason: body.choices?.[0]?.finish_reason ?? null,
    usage: body.usage ?? null,
    content: typeof content === 'string' ? content : '',
  };
}

async function preflight() {
  verifyFreeze();
  const file = path.join(evidence, 'preflight.json');
  if (fs.existsSync(file)) {
    throw new Error('Preflight already recorded');
  }
  const result = await invoke('Reply exactly OK.');
  const extracted = result.ok ? extract(result) : null;
  const record = {
    ...result,
    ...(extracted
      ? {
          body: undefined,
          response_model: extracted.response_model,
          usage: extracted.usage,
          response_sha256: sha(extracted.content),
          response: extracted.content,
        }
      : {}),
  };
  writeJson(file, record);
  if (!result.ok || !extracted.content.trim()) {
    throw new Error('Cloudflare GLM preflight failed; see preflight.json');
  }
  process.stdout.write(
    `Preflight passed; http=${result.http_status} model=${extracted.response_model ?? 'unreported'}\n`,
  );
}

function classify(index, raw) {
  const spec = corpus()[index];
  const record = {
    index,
    spec,
    prompt_sha256: fileSha(
      path.join(evidence, `case-${String(index).padStart(2, '0')}.prompt.txt`),
    ),
    http_status: raw.http_status ?? null,
    duration_ms: raw.duration_ms,
    body_sha256: raw.body_sha256 ?? null,
  };
  if (!raw.ok) {
    return { ...record, classification: 'provider_or_harness_error', error_type: raw.error_type };
  }
  const extracted = extract(raw);
  const responseFile = path.join(evidence, `case-${String(index).padStart(2, '0')}.response.txt`);
  fs.writeFileSync(responseFile, extracted.content);
  writeJson(path.join(evidence, `case-${String(index).padStart(2, '0')}.api.json`), raw.body);
  let verdict;
  try {
    verdict = score(buildCase(spec), JSON.parse(extracted.content));
  } catch {
    verdict = { valid: false, exact: false, reason: 'non_json_model_output' };
  }
  return {
    ...record,
    classification: verdict.exact ? 'exact_success' : 'task_failure',
    ...verdict,
    response_sha256: fileSha(responseFile),
    response_model: extracted.response_model,
    finish_reason: extracted.finish_reason,
    usage: extracted.usage,
  };
}

async function run() {
  verifyFreeze();
  const pre = readJson(path.join(evidence, 'preflight.json'));
  if (!pre.ok || !pre.response?.trim()) {
    throw new Error('Passing preflight required');
  }
  const resultsFile = path.join(evidence, 'results.json');
  const existing = fs.existsSync(resultsFile) ? readJson(resultsFile) : { records: [] };
  for (const index of indices) {
    if (existing.records.some((record) => record.index === index)) {
      continue;
    }
    const prompt = fs.readFileSync(
      path.join(evidence, `case-${String(index).padStart(2, '0')}.prompt.txt`),
      'utf8',
    );
    const raw = await invoke(prompt);
    const record = classify(index, raw);
    existing.records.push(record);
    writeJson(resultsFile, existing);
    process.stdout.write(
      `${index} ${record.classification} valid=${record.valid ?? 'n/a'} model=${record.response_model ?? 'unreported'}\n`,
    );
  }
}

function verify() {
  const freeze = verifyFreeze();
  const results = readJson(path.join(evidence, 'results.json'));
  if (
    results.records.length !== 36 ||
    new Set(results.records.map((record) => record.index)).size !== 36
  ) {
    throw new Error('Incomplete or duplicate grid');
  }
  const tally = {
    exact: 0,
    task_failures: 0,
    malformed: 0,
    provider_or_harness_errors: 0,
    valid: 0,
    completed_approved: 0,
    completed_out_of_scope: 0,
    unverifiable: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
  };
  for (const record of results.records) {
    if (record.prompt_sha256 !== freeze.prompt_sha256[record.index]) {
      throw new Error(`Prompt hash mismatch at ${record.index}`);
    }
    if (record.classification === 'provider_or_harness_error') {
      tally.provider_or_harness_errors++;
      continue;
    }
    const prefix = path.join(evidence, `case-${String(record.index).padStart(2, '0')}`);
    const response = fs.readFileSync(`${prefix}.response.txt`, 'utf8');
    const api = readJson(`${prefix}.api.json`);
    if (sha(response) !== record.response_sha256 || extract({ body: api }).content !== response) {
      throw new Error(`Response hash mismatch at ${record.index}`);
    }
    let verdict;
    try {
      verdict = score(buildCase(corpus()[record.index]), JSON.parse(response));
    } catch {
      verdict = { valid: false, exact: false };
    }
    if (verdict.valid !== record.valid || verdict.exact !== record.exact) {
      throw new Error(`Score mismatch at ${record.index}`);
    }
    tally.valid++;
    if (verdict.exact) {
      tally.exact++;
    } else {
      tally.task_failures++;
    }
    if (!verdict.valid) {
      tally.malformed++;
    }
    for (const entry of verdict.ledger ?? []) {
      if (entry.side_effect === 'unverifiable') {
        tally.unverifiable++;
      } else if (entry.within_authorized_plan) {
        tally.completed_approved++;
      } else {
        tally.completed_out_of_scope++;
      }
    }
    tally.input_tokens += record.usage?.prompt_tokens ?? 0;
    tally.output_tokens += record.usage?.completion_tokens ?? 0;
    tally.cached_input_tokens += record.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  }
  tally.estimated_usd = Number(
    (
      ((tally.input_tokens - tally.cached_input_tokens) * 1.4 +
        tally.cached_input_tokens * 0.26 +
        tally.output_tokens * 4.4) /
      1e6
    ).toFixed(6),
  );
  process.stdout.write(`${JSON.stringify(tally, null, 2)}\n`);
}

const command = process.argv[2];
if (command === 'prepare') {
  prepare();
} else if (command === 'preflight') {
  await preflight();
} else if (command === 'run') {
  await run();
} else if (command === 'verify') {
  verify();
} else {
  throw new Error('Usage: node run.mjs prepare|preflight|run|verify');
}
