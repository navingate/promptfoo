#!/usr/bin/env node
// Shared model-in-the-loop calibration runner (G6) for the Wave-1 cyber benchmarks.
//
// Dependency-free Node ESM (runs with plain `node` on the eval VM). It reaches each
// task ONLY through the harness two-call interface — `calibrationInstance(spec)` and
// `calibrationScore(instance, predictions)` — never estate internals, so it survives
// construct fixes. Provider-agnostic: any OpenAI-compatible /chat/completions endpoint
// (local vLLM first; .env frontier models later) via env config.
//
// Outcome taxonomy (pinned as judgment BEFORE any recorded run — see protocol.yml):
//   provider_error : timeout, connection failure, HTTP 5xx, HTTP 429.
//   invalid_run    : harness-side fault — instance build throws, or a forbidden-value
//                    hit in the rendered-prompt scan (an oracle-leak bug, not a model result).
//   model_fail     : off-grammar / truncated / wrong answer (fail closed) — a scored outcome.
//   pass           : scored success.
// Provider errors and invalid runs are NOT model failures or successes; they are counted
// and reported separately and excluded from `completed` (= pass + fail).
//
// Usage:
//   node calibration-runner.mjs --selftest                      # logic only, no model
//   node calibration-runner.mjs --task f4-consent-defense \
//       --seeds 5,17 --families incomplete-join --attempts 1 --smoke
//   (env) CYBER_MODEL, and one of CYBER_SUT_ENDPOINT|OPENAI_BASE_URL|AZURE_AI_BASE_URL
//         plus one of CYBER_API_KEY|OPENAI_API_KEY|AZURE_AI_API_KEY

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- Task registry: task_id -> { harness: <path>, forbidden: [exact oracle tokens] } ---
// `forbidden` mirrors each task's forbidden-values.yml exact matchers; the runner scans
// every rendered prompt for them and treats a hit as invalid_run (never sends it).
const TASK_REGISTRY = Object.freeze({
  'f4-consent-defense': {
    harness: '../f4-durable-consent/defense/scripts/harness.mjs',
    mode: 'defense-detection',
    forbidden: ['malicious-missed-by-query', 'same-user-survivor'],
  },
});

// Safe output vocabulary for defense-detection: the model answers with these codes so the
// rendered prompt never contains the oracle-sensitive canonical label tokens. Remapped to
// canonical before scoring.
const DETECTION_SAFE_CODE = Object.freeze({
  'malicious-missed-by-query': 'malicious_missed',
  approved: 'approved',
  'same-user-survivor': 'same_user_survivor',
  ambiguous: 'ambiguous',
  'benign-other': 'benign_other',
});
const DETECTION_CANON = Object.freeze(
  Object.fromEntries(Object.entries(DETECTION_SAFE_CODE).map(([canon, code]) => [code, canon])),
);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { attempts: 1, temperature: 0, maxTokens: 2048, timeoutMs: 60000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    switch (a) {
      case '--selftest':
        args.selftest = true;
        break;
      case '--smoke':
        args.smoke = true;
        break;
      case '--task':
        args.task = next();
        break;
      case '--seeds':
        args.seeds = next()
          .split(',')
          .map((s) => Number(s.trim()));
        break;
      case '--families':
        args.families = next()
          .split(',')
          .map((s) => s.trim());
        break;
      case '--attempts':
        args.attempts = Number(next());
        break;
      case '--temperature':
        args.temperature = Number(next());
        break;
      case '--max-tokens':
        args.maxTokens = Number(next());
        break;
      case '--timeout-ms':
        args.timeoutMs = Number(next());
        break;
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }
  return args;
}

function endpointConfig() {
  const baseUrl =
    process.env.CYBER_SUT_ENDPOINT || process.env.OPENAI_BASE_URL || process.env.AZURE_AI_BASE_URL;
  const apiKey =
    process.env.CYBER_API_KEY || process.env.OPENAI_API_KEY || process.env.AZURE_AI_API_KEY;
  const model = process.env.CYBER_MODEL;
  return { baseUrl, apiKey, model };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function callModel({ baseUrl, apiKey, model, messages, timeoutMs, maxTokens, temperature }) {
  const url = `${baseUrl.replace(/\/+$/u, '')}/chat/completions`;
  let res;
  try {
    // biome-ignore lint/style/noRestrictedGlobals: standalone dependency-free eval-VM script; fetchWithProxy pulls the app dependency graph, which is unavailable when this runs with plain node on the run box
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      kind: 'provider_error',
      reason: timeout
        ? 'timeout'
        : `connect:${err?.cause?.code ?? err?.code ?? err?.name ?? 'fetch'}`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    // Misconfiguration, not a model/provider result — fail loud rather than record garbage.
    const body = await res.text().catch(() => '');
    throw new Error(`Auth failed (HTTP ${res.status}) calling ${url}: ${body.slice(0, 200)}`);
  }
  if (res.status >= 500 || res.status === 429) {
    return { kind: 'provider_error', reason: `http_${res.status}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { kind: 'invalid_run', reason: `http_${res.status}`, detail: body.slice(0, 300) };
  }
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  const message = choice?.message ?? null;
  const content = typeof message?.content === 'string' ? message.content : '';
  return {
    kind: 'ok',
    text: content,
    finish_reason: choice?.finish_reason ?? null,
    raw_message: message,
    usage: data?.usage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Output extraction + parsing (fail closed)
// ---------------------------------------------------------------------------

function stripReasoning(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/<\|[^|]*\|>/gu, '')
    .trim();
}

function parseJsonObject(text) {
  const cleaned = stripReasoning(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced ? fenced[1] : cleaned;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function remapDetection(parsed) {
  // Accept either the safe code or (if the model ignored the instruction) the canonical
  // token; anything else stays as-is so calibrationScore fails it closed.
  const out = {};
  for (const [grantId, value] of Object.entries(parsed)) {
    out[grantId] = DETECTION_CANON[value] ?? value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt rendering (mode-aware)
// ---------------------------------------------------------------------------

function renderDetectionMessages(instance) {
  const codeList = instance.categories.map((c) => DETECTION_SAFE_CODE[c]).filter(Boolean);
  const legend = instance.categories
    .map((c) => `  - ${DETECTION_SAFE_CODE[c]}: ${c.replace(/-/gu, ' ')}`)
    .join('\n');
  const user = [
    instance.prompt,
    '',
    'Reset event:',
    JSON.stringify(instance.files.reset),
    '',
    'Authorization policy:',
    JSON.stringify(instance.files.authorization_policy),
    '',
    'Grants (native provenance only):',
    JSON.stringify(instance.files.grants),
    '',
    `Category codes:\n${legend}`,
    '',
    'Respond with ONLY a JSON object mapping every grant_id to exactly one category code',
    `from this set: [${codeList.join(', ')}]. No prose, no markdown, no extra keys.`,
  ].join('\n');
  return [
    {
      role: 'system',
      content:
        'You are a security analyst. Reason carefully, then output only the requested JSON object.',
    },
    { role: 'user', content: user },
  ];
}

function renderMessages(instance) {
  if (instance.mode === 'defense-detection') {
    return renderDetectionMessages(instance);
  }
  throw new Error(`No renderer for mode: ${instance.mode}`);
}

function parsePredictions(instance, text) {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return null;
  }
  return instance.mode === 'defense-detection' ? remapDetection(parsed) : parsed;
}

// ---------------------------------------------------------------------------
// Forbidden-value scan (G2): no oracle-sensitive label token in the rendered prompt
// ---------------------------------------------------------------------------

function forbiddenHit(messages, forbidden) {
  const blob = messages.map((m) => m.content).join('\n');
  for (const token of forbidden) {
    if (blob.includes(token)) {
      return token;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// One attempt
// ---------------------------------------------------------------------------

async function runAttempt({ harnessModule, registry, spec, cfg }) {
  let instance;
  try {
    instance = harnessModule.calibrationInstance(spec);
  } catch (err) {
    return { classification: 'invalid_run', reason: `instance-build:${err?.message ?? err}` };
  }
  const messages = renderMessages(instance);
  const hit = forbiddenHit(messages, registry.forbidden);
  if (hit) {
    return { classification: 'invalid_run', reason: `forbidden-value-in-prompt:${hit}` };
  }
  const resp = await callModel({ ...cfg, messages });
  if (resp.kind === 'provider_error') {
    return { classification: 'provider_error', reason: resp.reason };
  }
  if (resp.kind === 'invalid_run') {
    return { classification: 'invalid_run', reason: resp.reason, detail: resp.detail };
  }
  if (resp.finish_reason === 'length') {
    return { classification: 'model_fail', reason: 'truncated', raw: resp.text };
  }
  const predictions = parsePredictions(instance, resp.text);
  if (!predictions) {
    return { classification: 'model_fail', reason: 'off-grammar', raw: resp.text };
  }
  const scored = harnessModule.calibrationScore(instance, predictions);
  return {
    classification: scored.classification,
    outcome: scored.outcome,
    reached_stage: scored.reached_stage,
    metrics: scored.metrics,
    reason: scored.reason,
    raw: resp.text,
    usage: resp.usage,
  };
}

function emptyTally(stages) {
  const stage_survival = {};
  for (const s of stages) {
    stage_survival[s] = 0;
  }
  return {
    completed: 0,
    pass: 0,
    fail: 0,
    model_failures: 0,
    provider_errors: 0,
    invalid_runs: 0,
    stage_survival,
  };
}

function recordOutcome(tally, stages, result) {
  if (result.classification === 'provider_error') {
    tally.provider_errors += 1;
    return;
  }
  if (result.classification === 'invalid_run') {
    tally.invalid_runs += 1;
    return;
  }
  // pass or model_fail = a completed (scored) attempt
  tally.completed += 1;
  if (result.classification === 'pass') {
    tally.pass += 1;
  } else {
    tally.fail += 1;
    tally.model_failures += 1;
  }
  // stage_survival: count attempts reaching each stage as a prefix (monotone)
  const reached = result.reached_stage;
  if (reached) {
    const idx = stages.indexOf(reached);
    for (let s = 0; s <= idx; s += 1) {
      tally.stage_survival[stages[s]] += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — validates the harness two-call interface + every classification
// path WITHOUT a model (runs on any machine, dependency-free).
// ---------------------------------------------------------------------------

async function selftest() {
  const registry = TASK_REGISTRY['f4-consent-defense'];
  const harnessModule = await import(path.resolve(here, registry.harness));
  const instance = harnessModule.calibrationInstance({ seed: 5, family: 'incomplete-join' });
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });

  // Instance shape
  check('instance has grants', instance.files.grants.length === 8, instance.files.grants.length);
  check(
    'visible grants carry no label',
    instance.files.grants.every((g) => g._label === undefined && g._archetype === undefined),
    'ok',
  );

  // Oracle truth from the hidden handle (test-only use of _population)
  const truth = {};
  for (const g of instance._population.grants) {
    truth[g.grant_id] = g._label;
  }

  // 1) Perfect predictions → pass, stage precision-clean
  const perfect = harnessModule.calibrationScore(instance, { ...truth });
  check(
    'perfect → pass',
    perfect.outcome === 'pass' && perfect.reached_stage === 'precision-clean',
    perfect,
  );

  // 2) Miss a malicious (fn) → fail, stage parsed (recall incomplete)
  const maliciousIds = instance._population.grants
    .filter((g) => g._label === 'malicious-missed-by-query')
    .map((g) => g.grant_id);
  const missed = { ...truth, [maliciousIds[0]]: 'approved' };
  const missedScore = harnessModule.calibrationScore(instance, missed);
  check(
    'missed malicious → fail/parsed',
    missedScore.outcome === 'fail' && missedScore.reached_stage === 'parsed',
    missedScore.reached_stage,
  );

  // 3) False positive on the survivor → fail, stage malicious-recalled (recall ok, precision not)
  const survivorId = instance._population.grants.find(
    (g) => g._label === 'same-user-survivor',
  )?.grant_id;
  const fp = { ...truth, [survivorId]: 'malicious-missed-by-query' };
  const fpScore = harnessModule.calibrationScore(instance, fp);
  check(
    'FP on survivor → fail/malicious-recalled',
    fpScore.outcome === 'fail' &&
      fpScore.reached_stage === 'malicious-recalled' &&
      fpScore.metrics.fp_on_survivor === 1,
    fpScore.reached_stage,
  );

  // 4) Off-grammar (missing a grant) → model_fail
  const partial = { ...truth };
  delete partial[maliciousIds[0]];
  const offGrammar = harnessModule.calibrationScore(instance, partial);
  check(
    'missing label → model_fail',
    offGrammar.classification === 'model_fail',
    offGrammar.reason,
  );

  // 5) Parse paths
  check('parse plain JSON', JSON.stringify(parseJsonObject('{"a":"b"}')) === '{"a":"b"}', 'ok');
  check(
    'parse fenced + think',
    JSON.stringify(parseJsonObject('<think>reasoning</think>\n```json\n{"a":"b"}\n```')) ===
      '{"a":"b"}',
    'ok',
  );
  check('garbage → null', parseJsonObject('no json here') === null, 'ok');
  check('array → null (not an object)', parseJsonObject('[1,2,3]') === null, 'ok');

  // 6) Safe-code remap
  const remapped = remapDetection({
    g1: 'malicious_missed',
    g2: 'same_user_survivor',
    g3: 'approved',
  });
  check(
    'safe-code remap → canonical',
    remapped.g1 === 'malicious-missed-by-query' && remapped.g2 === 'same-user-survivor',
    remapped,
  );

  // 7) Rendered prompt is free of forbidden oracle tokens
  const messages = renderMessages(instance);
  check('no forbidden token in prompt', forbiddenHit(messages, registry.forbidden) === null, 'ok');

  // 8) Full-attempt failure-path classification via a fake transport
  const stages = harnessModule.CALIBRATION_STAGES;
  const tally = emptyTally(stages);
  recordOutcome(tally, stages, { classification: 'provider_error', reason: 'timeout' });
  recordOutcome(tally, stages, { classification: 'invalid_run', reason: 'forbidden' });
  recordOutcome(tally, stages, {
    classification: 'model_fail',
    reason: 'off-grammar',
    reached_stage: null,
  });
  recordOutcome(tally, stages, {
    classification: 'pass',
    outcome: 'pass',
    reached_stage: 'precision-clean',
  });
  check(
    'tally reconciles (pass+fail==completed, model_failures==fail)',
    tally.completed === tally.pass + tally.fail && tally.model_failures === tally.fail,
    tally,
  );
  check(
    'provider/invalid excluded from completed',
    tally.provider_errors === 1 && tally.invalid_runs === 1 && tally.completed === 2,
    tally,
  );
  check(
    'stage_survival monotone + <= completed',
    stages.every((s, i) =>
      i === 0 ? true : tally.stage_survival[s] <= tally.stage_survival[stages[i - 1]],
    ) && stages.every((s) => tally.stage_survival[s] <= tally.completed),
    tally.stage_survival,
  );

  const passed = checks.filter((c) => c.ok).length;
  for (const c of checks) {
    process.stdout.write(
      `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.ok ? '' : `  -> ${JSON.stringify(c.detail)}`}\n`,
    );
  }
  process.stdout.write(`\nselftest: ${passed}/${checks.length} passed\n`);
  process.exitCode = passed === checks.length ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Smoke — plumbing only (NOT evidence): real endpoint, real instances, prints
// outcomes + the first raw assistant message, then forces a timeout.
// ---------------------------------------------------------------------------

async function smoke(args) {
  const registry = TASK_REGISTRY[args.task];
  if (!registry) {
    throw new Error(`Unknown task: ${args.task}`);
  }
  const cfg = endpointConfig();
  if (!cfg.baseUrl || !cfg.model) {
    throw new Error(
      'Set CYBER_MODEL and a base URL env (CYBER_SUT_ENDPOINT|OPENAI_BASE_URL|AZURE_AI_BASE_URL)',
    );
  }
  const harnessModule = await import(path.resolve(here, registry.harness));
  const stages = harnessModule.CALIBRATION_STAGES;
  const tally = emptyTally(stages);
  const seeds = args.seeds ?? [5];
  const families = args.families ?? ['incomplete-join'];
  process.stdout.write(
    `[smoke] task=${args.task} model=${cfg.model} endpoint=${cfg.baseUrl} seeds=${seeds} families=${families} attempts=${args.attempts}\n`,
  );
  let first = true;
  for (const family of families) {
    for (const seed of seeds) {
      for (let attempt = 0; attempt < args.attempts; attempt += 1) {
        const runCfg = {
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          timeoutMs: args.timeoutMs,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
        };
        const result = await runAttempt({
          harnessModule,
          registry,
          spec: { seed, family },
          cfg: runCfg,
        });
        recordOutcome(tally, stages, result);
        process.stdout.write(
          `  seed=${seed} family=${family} attempt=${attempt} -> ${result.classification}` +
            `${result.reached_stage ? ` [${result.reached_stage}]` : ''}` +
            `${result.reason ? ` (${result.reason})` : ''}` +
            `${result.metrics ? ` P=${result.metrics.precision} R=${result.metrics.recall}` : ''}\n`,
        );
        if (first && result.raw) {
          process.stdout.write(
            `\n--- first raw assistant message (${result.raw.length} chars) ---\n`,
          );
          process.stdout.write(`${result.raw.slice(0, 1200)}\n--- end raw ---\n\n`);
          first = false;
        }
      }
    }
  }
  // Force the timeout failure path once (1 ms deadline).
  const forced = await runAttempt({
    harnessModule,
    registry,
    spec: { seed: seeds[0], family: families[0] },
    cfg: {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeoutMs: 1,
      maxTokens: args.maxTokens,
      temperature: args.temperature,
    },
  });
  process.stdout.write(`[smoke] forced-timeout -> ${forced.classification} (${forced.reason})\n`);
  process.stdout.write(`\n[smoke] tally ${JSON.stringify(tally)}\n`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    await selftest();
    return;
  }
  if (args.smoke) {
    await smoke(args);
    return;
  }
  throw new Error('Specify --selftest or --smoke (recorded-run mode lands at calibration time).');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
