import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, MODEL_SETTINGS, TOOL_CONTRACT } from './config.mjs';
import { readFrozenCorpus, scanObservationPlane } from './corpus.mjs';
import { createResponse, stepResponse } from './engine.mjs';
import { initialMessages, requestBody, SYSTEM_PROMPT, TOOL_SCHEMAS } from './interface.mjs';
import { scoreResponse } from './scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const familyRoot = path.resolve(here, '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const correction =
  'Your previous response did not contain exactly one valid native function call. Return exactly one function call using the published tool schema. Do not include prose or multiple calls.';
const findingFields = [
  'grant_id',
  'created_event_id',
  'reset_event_id',
  'token_event_id',
  'call_event_id',
];

function exactFields(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function validNativeArgs(tool, args) {
  if (!exactFields(args, TOOL_CONTRACT[tool])) {
    return false;
  }
  for (const [name, value] of Object.entries(args)) {
    if (name === 'on') {
      if (typeof value !== 'boolean') {
        return false;
      }
    } else if (name === 'findings') {
      if (
        !Array.isArray(value) ||
        !value.every(
          (finding) =>
            exactFields(finding, findingFields) &&
            findingFields.every(
              (field) => typeof finding[field] === 'string' && finding[field].length > 0,
            ),
        ) ||
        new Set(value.map((finding) => finding.grant_id)).size !== value.length
      ) {
        return false;
      }
    } else if (typeof value !== 'string' || value.length === 0) {
      return false;
    }
  }
  return true;
}

function failure(result, classification, reason) {
  result.classification = classification;
  result.reason = reason;
  return result;
}

function baseResult(item) {
  return {
    case_id: item?.id ?? null,
    spec: item?.spec ?? null,
    classification: null,
    reason: null,
    score: null,
    turns: 0,
    actions: 0,
    completion_tokens: 0,
    structural_corrections: 0,
    request_audit: [],
    raw_responses: [],
    raw_response_texts: [],
    transcript: [],
    dynamic_events: [],
    deliveries: [],
  };
}

function nativeSession(item) {
  if (!item?.native || !item?.key?.revocation_lag_ticks) {
    throw new Error('native and evaluator sidecars are required');
  }
  return createResponse({
    ...item.native,
    hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
  });
}

function stagedSurfaces(session, transcript) {
  const feedback = transcript.map((entry) => entry.result);
  return {
    prompt: SYSTEM_PROMPT,
    tool_schemas: TOOL_SCHEMAS,
    initial: session.initial,
    feedback,
    files: [],
    environment: [],
    artifacts: [],
    serialized_results: feedback.map((value) => JSON.stringify(value)),
  };
}

function parsedCall(choice) {
  if (choice?.finish_reason !== 'tool_calls') {
    return { reason: 'finish-without-native-call' };
  }
  const calls = choice.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1) {
    return { reason: 'native-call-count' };
  }
  const call = calls[0];
  if (
    typeof call?.id !== 'string' ||
    call.id.length === 0 ||
    call.type !== 'function' ||
    typeof call.function?.name !== 'string' ||
    !Object.hasOwn(TOOL_CONTRACT, call.function.name) ||
    typeof call.function?.arguments !== 'string'
  ) {
    return { reason: 'native-call-shape' };
  }
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return { reason: 'native-arguments-json' };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { reason: 'native-arguments-object' };
  }
  if (!validNativeArgs(call.function.name, args)) {
    return { reason: 'native-arguments-schema' };
  }
  return { call, command: { tool: call.function.name, args } };
}

function endpointUrl(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('Cloudflare HTTPS endpoint is required');
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash) {
    throw new Error('Cloudflare HTTPS endpoint is required');
  }
  return `${endpoint.replace(/\/+$/u, '')}/chat/completions`;
}

function httpFailure(status) {
  if (status === 401 || status === 403) {
    return { classification: 'provider_error', reason: `auth_http_${status}` };
  }
  return {
    classification: status === 400 || status === 422 ? 'invalid_native' : 'provider_error',
    reason: `http_${status}`,
  };
}

function frozenIssue(assertFrozen) {
  try {
    assertFrozen();
    return null;
  } catch (error) {
    return typeof error?.message === 'string' && error.message.startsWith('freeze-')
      ? error.message
      : 'freeze-binding-changed';
  }
}

function invalidateFrozenResult(result, reason) {
  result.classification = 'invalid_native';
  result.reason = reason;
  result.score = null;
  return result;
}

function pace(state, now, sleep) {
  return async (prepare, dispatch) => {
    let started = now();
    while (true) {
      if (
        state.last_request_start_ms !== null &&
        started - state.last_request_start_ms < MODEL_SETTINGS.minimum_request_start_gap_ms
      ) {
        const remaining =
          MODEL_SETTINGS.minimum_request_start_gap_ms - (started - state.last_request_start_ms);
        await sleep(remaining + 1);
        started = now();
        continue;
      }
      const requestInit = prepare();
      started = now();
      if (
        state.last_request_start_ms !== null &&
        started - state.last_request_start_ms < MODEL_SETTINGS.minimum_request_start_gap_ms
      ) {
        continue;
      }
      state.last_request_start_ms = started;
      dispatch(started, requestInit);
      return;
    }
  };
}

function appendAssistant(messages, message) {
  messages.push({
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  });
}

async function performRequest({ url, apiKey, request, startRequest, body, result }) {
  const bodyText = JSON.stringify(body);
  const audit = {
    sequence: result.turns + 1,
    started_ms: null,
    requested_model: body.model,
    completion_cap: body.max_completion_tokens,
    request_sha256: sha256(bodyText),
    response_status: null,
    served_model: null,
    finish_reason: null,
    completion_tokens: null,
  };
  const requestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'cf-aig-skip-cache': 'true',
    },
    body: bodyText,
  };
  let responsePromise;
  let requestFailure;
  let started;
  try {
    await startRequest(
      () => {
        try {
          return { ...requestInit, signal: AbortSignal.timeout(300000) };
        } catch (error) {
          requestFailure = { error };
          throw error;
        }
      },
      (dispatchStarted, init) => {
        started = dispatchStarted;
        if (!requestFailure) {
          try {
            responsePromise = request(url, init);
          } catch (error) {
            requestFailure = { error };
          }
        }
      },
    );
  } catch {
    return {
      classification: 'provider_error',
      reason: requestFailure ? 'transport-error' : 'transport-pacing',
    };
  }
  audit.started_ms = started;
  result.request_audit.push(audit);
  result.turns++;
  let response;
  try {
    if (requestFailure) {
      throw requestFailure.error;
    }
    response = await responsePromise;
  } catch (error) {
    audit.transport_error = error?.name ?? 'Error';
    return { classification: 'provider_error', reason: 'transport-error' };
  }
  if (!response || typeof response.text !== 'function' || typeof response.status !== 'number') {
    return { classification: 'provider_error', reason: 'transport-response-shape' };
  }
  audit.response_status = response.status;
  let rawText;
  try {
    rawText = await response.text();
  } catch {
    return { classification: 'provider_error', reason: 'transport-response-read' };
  }
  result.raw_response_texts.push(rawText);
  audit.response_sha256 = sha256(rawText);
  let responseBody;
  try {
    responseBody = JSON.parse(rawText);
  } catch {
    result.raw_responses.push(null);
    return response.status >= 200 && response.status < 300
      ? { classification: 'provider_error', reason: 'transport-response-json' }
      : httpFailure(response.status);
  }
  result.raw_responses.push(responseBody);
  audit.served_model = responseBody?.model ?? null;
  if (response.status < 200 || response.status >= 300) {
    return httpFailure(response.status);
  }
  if (responseBody?.model !== MODEL_SETTINGS.model_id) {
    return { classification: 'invalid_native', reason: 'served-model-echo-mismatch' };
  }
  const tokens = responseBody?.usage?.completion_tokens;
  if (!Number.isInteger(tokens) || tokens < 0) {
    return { classification: 'provider_error', reason: 'usage-missing-completion-tokens' };
  }
  audit.completion_tokens = tokens;
  result.completion_tokens += tokens;
  if (
    tokens > body.max_completion_tokens ||
    tokens > LIMITS.completion_tokens_per_turn ||
    result.completion_tokens > LIMITS.completion_tokens_total
  ) {
    return { classification: 'exhausted_budget', reason: 'completion-token-limit' };
  }
  if (!Array.isArray(responseBody.choices) || responseBody.choices.length !== 1) {
    return { classification: 'provider_error', reason: 'provider-choice-count' };
  }
  const choice = responseBody.choices[0];
  audit.finish_reason = choice?.finish_reason ?? null;
  const message = choice?.message;
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    message.role !== 'assistant' ||
    (message.content !== null &&
      message.content !== undefined &&
      typeof message.content !== 'string') ||
    (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))
  ) {
    return { classification: 'provider_error', reason: 'provider-message-shape' };
  }
  if (choice?.finish_reason === 'length') {
    return { classification: 'exhausted_budget', reason: 'completion-length' };
  }
  return { choice };
}

function scoreSubmission(session, key, result) {
  try {
    result.score = scoreResponse(session, key);
  } catch (error) {
    return {
      classification: 'invalid_native',
      reason: `scorer-replay: ${error?.message ?? 'error'}`,
    };
  }
  return result.score.exact
    ? { classification: 'exact', reason: null }
    : { classification: 'model_fail', reason: 'scored-security-failure' };
}

/** One fresh incident, one attempt. Inject request/clock in tests; no retry path exists. */
export async function runCase(
  item,
  {
    endpoint,
    apiKey,
    request = globalThis.fetch,
    now = Date.now,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    paceState = { last_request_start_ms: null },
    assertFrozen = () => {},
  } = {},
) {
  const result = baseResult(item);
  let session;
  try {
    session = nativeSession(item);
  } catch (error) {
    return failure(result, 'invalid_native', error?.message ?? 'invalid-native-case');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0 || typeof request !== 'function') {
    return failure(result, 'provider_error', 'transport-configuration');
  }
  let url;
  try {
    url = endpointUrl(endpoint);
  } catch {
    return failure(result, 'provider_error', 'transport-configuration');
  }
  const messages = initialMessages(session.initial);
  const startRequest = pace(paceState, now, sleep);
  const finish = (classification, reason) => {
    result.actions = session.action_count;
    result.dynamic_events = structuredClone(session.dynamic_events);
    result.deliveries = structuredClone(session.delivery_records);
    return failure(result, classification, reason);
  };

  while (result.turns < LIMITS.model_turns) {
    if (session.action_count >= LIMITS.tool_actions) {
      return finish('exhausted_budget', 'tool-action-limit');
    }
    const remainingTokens = LIMITS.completion_tokens_total - result.completion_tokens;
    if (remainingTokens <= 0) {
      return finish('exhausted_budget', 'completion-token-total');
    }
    const leaks = scanObservationPlane(stagedSurfaces(session, result.transcript));
    if (leaks.length > 0) {
      return finish('invalid_native', `observation-plane-leak: ${leaks.join(', ')}`);
    }
    const beforeIssue = frozenIssue(assertFrozen);
    if (beforeIssue) {
      return finish('invalid_native', beforeIssue);
    }
    const body = requestBody(messages);
    body.max_completion_tokens = Math.min(LIMITS.completion_tokens_per_turn, remainingTokens);
    const turn = await performRequest({ url, apiKey, request, startRequest, body, result });
    const afterIssue = frozenIssue(assertFrozen);
    if (afterIssue) {
      return finish('invalid_native', afterIssue);
    }
    if (turn.classification) {
      return finish(turn.classification, turn.reason);
    }
    const { choice } = turn;
    const parsed = parsedCall(choice);
    if (!parsed.call) {
      if (result.structural_corrections === 1) {
        return finish('format_fail', parsed.reason);
      }
      result.structural_corrections++;
      messages.push({ role: 'assistant', content: choice?.message?.content ?? '' });
      messages.push({ role: 'user', content: correction });
      continue;
    }
    const toolResult = stepResponse(session, parsed.command);
    result.transcript.push({
      turn: result.turns,
      command: parsed.command,
      result: toolResult,
    });
    appendAssistant(messages, choice.message);
    messages.push({
      role: 'tool',
      tool_call_id: parsed.call.id,
      content: JSON.stringify(toolResult),
    });
    if (session.submitted) {
      const scored = scoreSubmission(session, item.key, result);
      return finish(scored.classification, scored.reason);
    }
  }
  return finish('exhausted_budget', 'model-turn-limit');
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function gitCheckoutAncestor(directory) {
  let current = directory;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

export function validateRawOutput(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) {
    throw new Error('raw output must be an absolute path outside the repository');
  }
  const canonicalParent = fs.realpathSync.native(path.dirname(output));
  const candidate = path.join(canonicalParent, path.basename(output));
  const canonicalRepo = fs.realpathSync.native(repoRoot);
  if (inside(canonicalRepo, candidate) || gitCheckoutAncestor(canonicalParent)) {
    throw new Error('raw output must be outside the repository');
  }
  return candidate;
}

function reserveRawOutput(output) {
  const destination = validateRawOutput(output);
  let handle;
  try {
    handle = fs.openSync(destination, 'wx', 0o600);
    fs.fchmodSync(handle, 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('raw output already exists');
    }
    throw error;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
  return destination;
}

function persistRaw(output, value) {
  if (validateRawOutput(output) !== output) {
    throw new Error('raw output destination changed');
  }
  const temporary = `${output}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    if (validateRawOutput(output) !== output) {
      throw new Error('raw output destination changed');
    }
    fs.renameSync(temporary, output);
  } catch (error) {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** Sequential frozen grid, with a persisted first-case inspection gate in the same invocation. */
export async function runFrozenScreen({
  root = here,
  output,
  onFirstCaseCheckpoint,
  ...caseOptions
} = {}) {
  if (typeof onFirstCaseCheckpoint !== 'function') {
    throw new Error('first-case checkpoint callback is required');
  }
  const { manifest, cases } = readFrozenCorpus(root);
  const manifestPath = path.join(root, 'manifest.json');
  const manifestSha256 = sha256(fs.readFileSync(manifestPath));
  const bindings = [
    ...Object.entries(manifest.source_sha256).map(([relative, digest]) => ({
      filename: path.join(familyRoot, relative),
      digest,
    })),
    ...manifest.cases.flatMap((row) => [
      { filename: path.join(root, row.native_path), digest: row.native_sha256 },
      { filename: path.join(root, row.key_path), digest: row.key_sha256 },
    ]),
  ];
  const assertFrozen = () => {
    if (sha256(fs.readFileSync(manifestPath)) !== manifestSha256) {
      throw new Error('freeze-manifest-changed');
    }
    for (const binding of bindings) {
      if (sha256(fs.readFileSync(binding.filename)) !== binding.digest) {
        throw new Error('freeze-binding-changed');
      }
    }
  };
  const destination = reserveRawOutput(output);
  const paceState = { last_request_start_ms: null };
  const results = [];
  const snapshot = () => ({
    task_id: manifest.task_id,
    manifest_sha256: manifestSha256,
    completed_cases: results.length,
    next_case_index: results.length,
    results,
  });
  for (const item of cases) {
    const caseResult = await runCase(item, { ...caseOptions, paceState, assertFrozen });
    const caseIssue = frozenIssue(assertFrozen);
    results.push(caseIssue ? invalidateFrozenResult(caseResult, caseIssue) : caseResult);
    persistRaw(destination, snapshot());
    if (['provider_error', 'invalid_native'].includes(results.at(-1).classification)) {
      break;
    }
    if (results.length === 1) {
      await onFirstCaseCheckpoint(snapshot());
      const checkpointIssue = frozenIssue(assertFrozen);
      if (checkpointIssue) {
        invalidateFrozenResult(results[0], checkpointIssue);
        persistRaw(destination, snapshot());
        break;
      }
    }
  }
  return snapshot();
}
