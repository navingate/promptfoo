#!/usr/bin/env node
// Model loop for the F4 shared-reset investigation. No Promptfoo core change.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  MAX_COMMANDS_PER_TURN,
  MAX_TOKENS_PER_TURN,
  MAX_TURNS,
  REASONING_EFFORT,
  SYSTEM_PROMPT,
  TEMPERATURE,
} from './config.mjs';
import { readFrozenCorpus } from './corpus.mjs';
import {
  createInvestigation,
  referenceInvestigate,
  scoreInvestigation,
  stepInvestigation,
} from './investigation.mjs';

const MAX_RESPONSE_BYTES = 32768;
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function parseCommands(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    return null;
  }
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text);
  if (fence) {
    text = fence[1];
  }
  try {
    const value = JSON.parse(text);
    const commands = Array.isArray(value) ? value : [value];
    if (
      commands.length < 1 ||
      commands.length > MAX_COMMANDS_PER_TURN ||
      commands.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          typeof item.tool !== 'string' ||
          (item.args !== undefined &&
            (!item.args || typeof item.args !== 'object' || Array.isArray(item.args))),
      )
    ) {
      return null;
    }
    return commands.map((item) => ({ tool: item.tool, args: item.args ?? {} }));
  } catch {
    return null;
  }
}

function outcome(classification, reason, score, turns, session, transcript, includeTranscript) {
  return {
    classification,
    ...(reason ? { reason } : {}),
    score,
    turns,
    actions: session.actions,
    ...(includeTranscript ? { transcript } : {}),
  };
}

function applyCommands(session, commands) {
  const results = [];
  for (const command of commands) {
    results.push(stepInvestigation(session, command));
    if (session.finished) {
      break;
    }
  }
  return results;
}

export async function runOne(episode, key, modelCall, { includeTranscript = false } = {}) {
  const session = createInvestigation(episode);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(session.initial) },
  ];
  const transcript = [];
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await modelCall(messages);
    if (response?.issue) {
      return outcome(
        response.issue,
        response.reason,
        null,
        turn + 1,
        session,
        transcript,
        includeTranscript,
      );
    }
    if (response?.finish_reason !== 'stop') {
      return outcome(
        'format_fail',
        'incomplete-response',
        null,
        turn + 1,
        session,
        transcript,
        includeTranscript,
      );
    }
    const commands = parseCommands(response.raw);
    if (!commands) {
      return outcome(
        'format_fail',
        'invalid-json-command',
        null,
        turn + 1,
        session,
        transcript,
        includeTranscript,
      );
    }
    const results = applyCommands(session, commands);
    transcript.push({ turn: turn + 1, response_hash: sha(response.raw), commands, results });
    messages.push({ role: 'assistant', content: response.raw });
    messages.push({
      role: 'user',
      content: JSON.stringify(results.length === 1 ? results[0] : { results }),
    });
    if (session.finished) {
      if (results.at(-1)?.reason === 'action-budget-exhausted') {
        return outcome(
          'budget_exhausted',
          'action-budget-exhausted',
          null,
          turn + 1,
          session,
          transcript,
          includeTranscript,
        );
      }
      const score = scoreInvestigation(session, key);
      return outcome(
        score.classification,
        null,
        score,
        turn + 1,
        session,
        transcript,
        includeTranscript,
      );
    }
  }
  return outcome(
    'budget_exhausted',
    'turn-budget-exhausted',
    null,
    MAX_TURNS,
    session,
    transcript,
    includeTranscript,
  );
}

// biome-ignore lint/style/noRestrictedGlobals: standalone benchmark runner with injectable request for mocked tests
export async function requestOpenAICompatible(messages, config, request = fetch) {
  let response;
  try {
    response = await request(`${config.endpoint.replace(/\/+$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        ...(config.cloudflare ? { 'cf-aig-skip-cache': 'true' } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS_PER_TURN,
        reasoning_effort: REASONING_EFFORT,
        stream: false,
      }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    return { issue: 'provider_error', reason: error?.name ?? 'connection-error' };
  }
  if (!response.ok) {
    return {
      issue: response.status === 429 || response.status >= 500 ? 'provider_error' : 'invalid_run',
      reason: `http_${response.status}`,
    };
  }
  const body = await response.json().catch(() => null);
  if (body?.model !== config.model) {
    return { issue: 'invalid_run', reason: 'served-model-echo-mismatch' };
  }
  const choice = body?.choices?.[0];
  if (typeof choice?.message?.content !== 'string') {
    return { issue: 'invalid_run', reason: 'malformed-provider-response' };
  }
  return {
    raw: choice.message.content,
    finish_reason: choice.finish_reason,
    usage: body.usage ?? null,
  };
}

function argsFrom(argv) {
  const options = { mode: null, episode: 0, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reference' || argv[i] === '--manual' || argv[i] === '--live') {
      options.mode = argv[i].slice(2);
    } else if (argv[i] === '--episode') {
      options.episode = Number(argv[++i]);
    } else if (argv[i] === '--output') {
      options.output = argv[++i];
    } else {
      throw new Error(`unknown option: ${argv[i]}`);
    }
  }
  if (!options.mode || !Number.isInteger(options.episode) || options.episode < 0) {
    throw new Error('choose --reference, --manual, or --live and a valid --episode');
  }
  return options;
}

async function manual(episode) {
  const session = createInvestigation(episode);
  const line = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(
    `${JSON.stringify({ system_prompt: SYSTEM_PROMPT, initial: session.initial })}\n`,
  );
  try {
    for (let turn = 0; turn < MAX_TURNS && !session.finished; turn += 1) {
      const raw = await line.question('command> ');
      const commands = parseCommands(raw);
      if (!commands) {
        process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid-json-command' })}\n`);
        continue;
      }
      const results = [];
      for (const command of commands) {
        results.push(stepInvestigation(session, command));
        if (session.finished) {
          break;
        }
      }
      process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : { results })}\n`);
    }
  } finally {
    line.close();
  }
}

async function main() {
  const options = argsFrom(process.argv.slice(2));
  const { episodes, keys, manifest } = readFrozenCorpus();
  const episode = episodes[options.episode];
  const key = keys[options.episode];
  if (!episode) {
    throw new Error('episode outside frozen corpus');
  }
  if (options.mode === 'reference') {
    const scores = episodes.map((item, index) => {
      const session = createInvestigation(item);
      const findings = referenceInvestigate(session);
      stepInvestigation(session, { tool: 'submit', args: { findings } });
      return scoreInvestigation(session, keys[index]);
    });
    process.stdout.write(
      `${JSON.stringify({ candidate: manifest.candidate_id, exact: scores.filter((score) => score.exact).length, total: scores.length, scores })}\n`,
    );
    return;
  }
  if (options.mode === 'manual') {
    await manual(episode);
    return;
  }
  if (!options.output || !path.isAbsolute(options.output)) {
    throw new Error('--live requires an absolute private --output path');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const worktreeRoot = path.resolve(here, '../../../../..');
  const repositoryRoot = path.resolve(worktreeRoot, '../..');
  const output = path.join(
    fs.realpathSync(path.dirname(path.resolve(options.output))),
    path.basename(options.output),
  );
  if (
    [worktreeRoot, repositoryRoot].some(
      (root) => output === root || output.startsWith(`${root}${path.sep}`),
    )
  ) {
    throw new Error('private output must be outside repository');
  }
  const config = {
    endpoint: process.env.F4_MODEL_ENDPOINT ?? process.env.CLOUDFLARE_OPENAI_BASE_URL,
    apiKey: process.env.F4_MODEL_API_KEY ?? process.env.CLOUDFLARE_API_KEY,
    model: process.env.F4_MODEL_ID,
    cloudflare: Boolean(process.env.CLOUDFLARE_OPENAI_BASE_URL),
  };
  if (
    !config.endpoint ||
    !config.apiKey ||
    !config.model ||
    new URL(config.endpoint).protocol !== 'https:'
  ) {
    throw new Error('valid endpoint, key, and model ID are required');
  }
  const result = await runOne(
    episode,
    key,
    (messages) => requestOpenAICompatible(messages, config),
    { includeTranscript: true },
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    `${JSON.stringify({ candidate: manifest.candidate_id, episode: options.episode, model: config.model, result })}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  process.stdout.write(
    `${JSON.stringify({ candidate: manifest.candidate_id, episode: options.episode, classification: result.classification, score: result.score, turns: result.turns, actions: result.actions })}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
