#!/usr/bin/env node
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { parseCommands } from '../v8/commands.mjs';
import { callModel, DEFAULTS, PROMPTS } from '../v8/runner.mjs';
import {
  screenSettings as v9Settings,
  withLowReasoning,
} from '../v9/cloudflare-glm53-v9-screen.mjs';
import {
  createRetryingPacedFetch,
  MIN_REQUEST_GAP_MS,
  REQUEST_WALL_MS,
  RETRY_DELAYS_MS,
} from '../v9/retry-fetch.mjs';
import { createDefenseSession, scoreDefense, stepDefense } from '../v10/defense.mjs';
import { FAMILIES, SUBTYPES } from '../v10/graph.mjs';
import {
  createGrantStageSession,
  createOffenseSession,
  scoreOffense,
  stepOffense,
} from './offense.mjs';

export const SCREEN_VERSION = 'f9-v11-interface-cloudflare-glm53-low16';
export const EXACT_MODEL = '@cf/zai-org/glm-5.3';
export const MAX_TOKENS = 16384;
export const CASE_WALL_MS = 20 * 60 * 1000;
export const OFFENSE_SEEDS = Object.freeze(Array.from({ length: 12 }, (_, index) => 32001 + index));
export const DEFENSE_SEEDS = Object.freeze(OFFENSE_SEEDS.slice(0, 3));
export const PILOT_SEED = 31901;
export const screenSettings = v9Settings;

function casesFor(mode) {
  if (mode === 'pilot-offense') {
    return [{ seed: PILOT_SEED, family: 'cached-interval' }];
  }
  if (mode === 'offense' || mode === 'grant-stage') {
    return OFFENSE_SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })));
  }
  if (mode === 'defense') {
    return DEFENSE_SEEDS.flatMap((seed) =>
      FAMILIES.flatMap((family) =>
        SUBTYPES.map((subtype) => ({ seed, family, subtype, malicious: subtype === 'malicious' })),
      ),
    );
  }
  throw new Error('mode must be pilot-offense, offense, grant-stage, or defense');
}

function summaryFor(mode, assigned, results, status) {
  const count = (classification) =>
    results.filter((result) => result.classification === classification).length;
  const pass = count('pass');
  const valid = results.filter((result) => result.valid_output).length;
  const unattempted = assigned - results.length;
  const scoredAssigned = mode === 'pilot-offense' ? 0 : assigned;
  const nativeStageReach = Object.fromEntries(
    ['auth', 'grant', 'read'].map((stage) => [
      stage,
      results.filter((result) => result.score.stages?.[stage]).length,
    ]),
  );
  const nativeSyntaxErrors = results.reduce(
    (sum, result) =>
      sum +
      result.transcript.reduce(
        (count, turn) =>
          count + (turn.results?.filter((item) => item.error === 'invalid-arguments').length ?? 0),
        0,
      ),
    0,
  );
  return {
    mode,
    model: EXACT_MODEL,
    endpoint_id: 'cloudflare-workers-ai-openai-compat',
    prompt_sha256: crypto
      .createHash('sha256')
      .update(PROMPTS[mode === 'pilot-offense' ? 'offense' : mode])
      .digest('hex'),
    assigned_cases: assigned,
    scored_assigned_cases: scoredAssigned,
    attempted_cases: results.length,
    pass,
    valid_output_runs: valid,
    model_fail: count('model_fail'),
    provider_error: count('provider_error'),
    invalid_run: count('invalid_run'),
    timed_out: count('timed_out'),
    assigned_but_unattempted: unattempted,
    unattempted_after_halt:
      status === 'halted-provider' || status === 'halted-invalid' ? unattempted : 0,
    preflight_not_run: status === 'preflight-failed' ? unattempted : 0,
    intentionally_unattempted: status === 'limited' ? unattempted : 0,
    all_slot_rate: scoredAssigned ? pass / scoredAssigned : null,
    valid_case_rate: scoredAssigned && valid ? pass / valid : null,
    off_grammar: results.filter((result) => result.reason === 'off-grammar').length,
    truncated: results.filter((result) => result.reason === 'truncated').length,
    format_errors: results.reduce((sum, result) => sum + (result.format_errors ?? 0), 0),
    native_stage_reach: nativeStageReach,
    native_syntax_errors: nativeSyntaxErrors,
    diagnostic_counts: aggregateDiagnosticCounts(results),
  };
}

export function offenseDiagnostics(session) {
  const diagnostics = [];
  for (const event of session.ledger) {
    if (event.type !== 'auth.attempt' && event.type !== 'grant.redeem') {
      continue;
    }
    const stage = event.type === 'auth.attempt' ? 'auth' : 'grant';
    if (stage === 'auth') {
      const route = session.estate.routes.find((item) => item.id === event.route);
      const assignment = session.estate.principals.find((item) => item.service === route?.service);
      const shadowDeployment = session.estate.deployments.some(
        (item) =>
          item.service === route?.service &&
          item.mount_ref === route?.mount_ref &&
          item.principal === event.principal &&
          event.principal !== assignment?.principal,
      );
      if (shadowDeployment) {
        diagnostics.push({ kind: 'shadow_route_probe', stage, reason: event.reason });
      }
    }
    if (!event.allowed) {
      diagnostics.push({ kind: 'native_denial', stage, reason: event.reason });
    }
  }
  return diagnostics;
}

function aggregateDiagnosticCounts(results) {
  const counts = { shadow_route_probes: { auth: {} }, native_denials: { auth: {}, grant: {} } };
  for (const result of results) {
    for (const { kind, stage, reason } of result.diagnostics ?? []) {
      const category =
        kind === 'shadow_route_probe' ? counts.shadow_route_probes : counts.native_denials;
      category[stage][reason] = (category[stage][reason] ?? 0) + 1;
    }
  }
  return counts;
}

function checkpoint(output, report) {
  const temporary = `${output}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, output);
}

function caseTimer(ms) {
  let id;
  return {
    promise: new Promise((resolve) => {
      id = setTimeout(resolve, ms);
    }),
    cancel: () => clearTimeout(id),
  };
}

function sleepWithAbort(sleep, signal, ms) {
  if (!sleep) {
    return signal ? delay(ms, undefined, { signal }) : delay(ms);
  }
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (done, value) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      done(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => sleep(ms))
      .then(
        (value) => finish(resolve, value),
        (cause) => finish(reject, cause),
      );
  });
}

function runtimeFor(mode, spec) {
  if (mode === 'defense') {
    return {
      session: createDefenseSession(spec),
      step: stepDefense,
      score: scoreDefense,
      maxTurns: DEFAULTS.maxTurnsDefense,
      maxActions: DEFAULTS.maxActionsDefense,
    };
  }
  return {
    session: mode === 'offense' ? createOffenseSession(spec) : createGrantStageSession(spec),
    step: stepOffense,
    score: scoreOffense,
    maxTurns: mode === 'offense' ? DEFAULTS.maxTurnsOffense : DEFAULTS.maxTurnsGrantStage,
    maxActions: mode === 'offense' ? DEFAULTS.maxActionsOffense : DEFAULTS.maxActionsGrantStage,
  };
}

function offenseEnded(session, scored) {
  return (
    (session.authAttempts >= session.initial.limits.authentication_attempts && !session.auth) ||
    (session.grantAttempts > 0 && !session.grant) ||
    session.readAttempts > 0 ||
    scored.success
  );
}

function terminalReason(session, defense, scored, actions, maxActions) {
  if (scored.success) {
    return null;
  }
  if (actions >= maxActions) {
    return 'action-budget-exhausted';
  }
  if (!defense && session.authAttempts > 0 && !session.auth) {
    return 'denied-stale-auth';
  }
  if (!defense && session.grantAttempts > 0 && !session.grant) {
    return 'denied-grant-redemption';
  }
  return 'terminal-failure';
}

function commandsFor(reply, defense, session) {
  return defense && reply.text.trim() === '[]' && session.declared
    ? [{ tool: 'finish' }]
    : parseCommands(reply.text);
}

async function oneCase(spec, mode, cfg, onState, signal) {
  const liveSpec = { ...spec, nonce: crypto.randomBytes(32).toString('hex') };
  const defense = mode === 'defense';
  const { session, step, score, maxTurns, maxActions } = runtimeFor(mode, liveSpec);
  const messages = [
    { role: 'system', content: PROMPTS[mode] },
    { role: 'user', content: JSON.stringify(session.initial) },
  ];
  const transcript = [];
  let actions = 0;
  let formatErrors = 0;
  const result = (classification, reason, valid_output) => ({
    spec,
    scenario_nonce: liveSpec.nonce,
    ...(defense ? { native_capture: structuredClone(session.capture) } : {}),
    classification,
    reason,
    valid_output,
    score: score(session),
    transcript,
    actions,
    format_errors: formatErrors,
    ledger: defense ? session.action_ledger : session.ledger,
    diagnostics: defense ? [] : offenseDiagnostics(session),
  });
  onState(() => structuredClone(result('timed_out', 'case-wall-limit', false)));
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const reply = await callModel(messages, cfg);
    if (signal.aborted) {
      return null;
    }
    if (reply.kind !== 'ok') {
      return result(reply.kind, reply.reason, false);
    }
    const raw = {
      raw: reply.text,
      finish_reason: reply.finish_reason,
      usage: reply.usage,
      served_model: reply.served_model,
    };
    if (reply.finish_reason === 'length') {
      transcript.push(raw);
      return result('model_fail', 'truncated', true);
    }
    const commands = commandsFor(reply, defense, session);
    if (!commands) {
      formatErrors += 1;
      transcript.push({ ...raw, parse_error: 'no-json-command' });
      if (formatErrors > DEFAULTS.formatRepairs) {
        return result('invalid_run', 'off-grammar', false);
      }
      messages.push({ role: 'assistant', content: reply.text });
      messages.push({
        role: 'user',
        content:
          'Please return only a JSON tool command or array of commands using the listed schema.',
      });
      continue;
    }
    const observations = [];
    for (const command of commands) {
      if (actions >= maxActions) {
        break;
      }
      actions += 1;
      observations.push(step(session, command));
      if (session.finished) {
        break;
      }
    }
    transcript.push({ ...raw, commands, results: observations });
    const scored = score(session);
    const terminal =
      session.finished || actions >= maxActions || (!defense && offenseEnded(session, scored));
    if (terminal) {
      const reason = terminalReason(session, defense, scored, actions, maxActions);
      return result(scored.success ? 'pass' : 'model_fail', reason, true);
    }
    messages.push({ role: 'assistant', content: reply.text });
    messages.push({
      role: 'user',
      content: JSON.stringify(
        observations.length === 1 ? observations[0] : { results: observations },
      ),
    });
  }
  return result('model_fail', 'turn-budget-exhausted', true);
}

export async function runPacedScreen(
  mode,
  cfg,
  output,
  {
    fetchImpl = null,
    transportOptions = {},
    caseTimer: makeTimer = caseTimer,
    maxCases = Infinity,
  } = {},
) {
  const cases = casesFor(mode);
  const runMode = mode === 'pilot-offense' ? 'offense' : mode;
  if (path.resolve(output) !== output || !output.startsWith('/tmp/') || !output.endsWith('.json')) {
    throw new Error('raw output must be an absolute /tmp/*.json path');
  }
  if (cfg.model !== EXACT_MODEL || cfg.timeoutMs > REQUEST_WALL_MS || maxCases < 1) {
    throw new Error('invalid screen settings');
  }
  fs.closeSync(fs.openSync(output, 'wx', 0o600));
  const results = [];
  const report = {
    screen_version: SCREEN_VERSION,
    transport_min_interval_ms: MIN_REQUEST_GAP_MS,
    transport_retry_delays_ms: RETRY_DELAYS_MS,
    transport_request_wall_ms: REQUEST_WALL_MS,
    case_wall_ms: CASE_WALL_MS,
    reasoning_effort: 'low',
    max_tokens: MAX_TOKENS,
    status: 'prepared',
    preflight: null,
    summary: summaryFor(mode, cases.length, results, 'prepared'),
    request_starts: [],
    transport_requests: [],
    results,
  };
  checkpoint(output, report);
  let currentSlot = 'preflight';
  const caseContext = new AsyncLocalStorage();
  const frozenRequests = new Map();
  const frozenStartLimits = new Map();
  const baseSleep = transportOptions.sleep;
  let reportClosed = false;
  let transport;
  const syncTransport = () => {
    report.request_starts = transport.starts
      .filter(
        (start) =>
          start.attempt <= (frozenStartLimits.get(start.logical_request_index) ?? Infinity),
      )
      .map((start) => structuredClone(start));
    report.transport_requests = transport.requests.map(
      (request) => frozenRequests.get(request.logical_request_index) ?? structuredClone(request),
    );
  };
  const onTransportUpdate = () => {
    if (reportClosed) {
      return;
    }
    syncTransport();
    checkpoint(output, report);
  };
  transport = createRetryingPacedFetch(fetchImpl ?? cfg.fetchImpl ?? globalThis.fetch, {
    ...transportOptions,
    attemptTimeoutMs: cfg.timeoutMs,
    getSlot: () => currentSlot,
    sleep: (ms) => sleepWithAbort(baseSleep, caseContext.getStore(), ms),
    onUpdate: onTransportUpdate,
  });
  const liveCfg = { ...cfg, maxTokens: MAX_TOKENS, fetchImpl: withLowReasoning(transport.fetch) };
  const preflight = await callModel([{ role: 'user', content: 'Return PONG.' }], {
    ...liveCfg,
    maxTokens: 16,
  });
  report.preflight =
    preflight.kind === 'ok'
      ? { kind: 'ok', served_model: preflight.served_model }
      : { kind: preflight.kind, reason: preflight.reason };
  if (preflight.kind !== 'ok') {
    report.status = 'preflight-failed';
    report.summary = summaryFor(mode, cases.length, results, report.status);
    checkpoint(output, report);
    reportClosed = true;
    return report;
  }
  report.status = 'running';
  checkpoint(output, report);
  for (const spec of cases.slice(0, maxCases)) {
    currentSlot = `${spec.seed}/${spec.family}${spec.subtype ? `/${spec.subtype}` : ''}`;
    const caseAbort = new AbortController();
    let snapshot = null;
    const caseCfg = {
      ...liveCfg,
      fetchImpl: withLowReasoning((url, options) => {
        if (caseAbort.signal.aborted) {
          throw caseAbort.signal.reason;
        }
        return caseContext.run(caseAbort.signal, () =>
          transport.fetch(url, {
            ...options,
            signal: AbortSignal.any([options.signal, caseAbort.signal]),
          }),
        );
      }),
    };
    const timer = makeTimer(CASE_WALL_MS);
    const finished = await Promise.race([
      oneCase(
        spec,
        runMode,
        caseCfg,
        (current) => {
          snapshot = current;
        },
        caseAbort.signal,
      ),
      timer.promise.then(() => snapshot()),
    ]);
    timer.cancel();
    if (finished.classification === 'timed_out') {
      for (const request of transport.requests.filter((item) => item.slot === currentSlot)) {
        const frozen = structuredClone(request);
        if (frozen.outcome === 'running') {
          frozen.outcome = 'case-wall-limit';
        }
        frozenRequests.set(request.logical_request_index, frozen);
        frozenStartLimits.set(request.logical_request_index, request.attempts);
      }
      syncTransport();
      caseAbort.abort();
    }
    results.push(finished);
    if (finished.classification === 'provider_error') {
      report.status = 'halted-provider';
    }
    if (finished.classification === 'invalid_run') {
      report.status = 'halted-invalid';
    }
    report.summary = summaryFor(mode, cases.length, results, report.status);
    checkpoint(output, report);
    if (report.status !== 'running') {
      reportClosed = true;
      return report;
    }
  }
  report.status = maxCases < cases.length ? 'limited' : 'complete';
  report.summary = summaryFor(mode, cases.length, results, report.status);
  checkpoint(output, report);
  reportClosed = true;
  return report;
}

async function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--mode' || argv[2] !== '--output') {
    throw new Error(
      'usage: screen.mjs --mode <pilot-offense|offense|grant-stage|defense> --output /tmp/file.json',
    );
  }
  const report = await runPacedScreen(argv[1], screenSettings(), argv[3]);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, preflight: report.preflight, ...report.summary })}\n`,
  );
  process.stdout.write(`raw_capture=${argv[3]}\n`);
  if (report.status !== 'complete') {
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
}
