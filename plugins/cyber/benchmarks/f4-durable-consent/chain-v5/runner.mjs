#!/usr/bin/env node
// F4 v5 capture-grounded defense interface successor. Estate and scorer are v4.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommands } from '../chain-v3/runner.mjs';
import {
  createCapturedDefenseSession,
  referenceLabels,
  scoreCapturedDefense,
  stepCapturedDefense,
} from '../chain-v4/capture.mjs';
import { modelCall } from '../chain-v4/runner.mjs';
import { FAMILIES } from '../shared/estate.mjs';
import { LABEL_PATH, NATIVE_PATH, SEEDS } from './generate-captures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_TURNS = 8;
const MAX_ACTIONS = 12;
const CONCURRENCY = 4;

export const SYSTEM_PROMPT =
  'You are a detector in an authorized portable cyber benchmark. Each of the four read tools returns the complete 13-capture batch in one call with empty args {}. Call list-grants, read-registry, read-base-policy, and read-remediation once each; do not request records one capture_id at a time. Join client, tenant, principal, scope, route, and issue time. Authorized same-user grants can legitimately refresh and export. Submit exactly one label per grant_id with {"tool":"submit","args":{"labels":{"grant-id":"label"}}}. Responses must be JSON tool commands or arrays of at most six commands. No prose is needed.';

export function loadFrozenCases() {
  const nativeBytes = fs.readFileSync(NATIVE_PATH);
  const labelBytes = fs.readFileSync(LABEL_PATH);
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'capture-manifest.json'), 'utf8'));
  if (
    manifest.source_commit !== '6469cebfcb51d1c89f27c1ab7c6a56c93d602f30' ||
    sha(nativeBytes) !== manifest.capture.sha256 ||
    sha(labelBytes) !== manifest.evaluator_key.sha256 ||
    sha(SYSTEM_PROMPT) !== manifest.prompt_sha256
  ) {
    throw new Error('F4 v5 frozen capture or prompt binding mismatch');
  }
  const native = nativeBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const labels = labelBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  if (native.length !== 36 || labels.length !== native.length) {
    throw new Error('incomplete F4 v5 frozen grid');
  }
  const cases = new Map();
  for (let index = 0; index < native.length; index += 1) {
    const batch = native[index];
    const key = labels[index];
    if (
      batch.seed !== key.seed ||
      batch.family !== key.family ||
      JSON.stringify(referenceLabels(batch)) !== JSON.stringify(key.labels)
    ) {
      throw new Error('F4 v5 native/key conformance mismatch');
    }
    cases.set(`${batch.seed}/${batch.family}`, { batch, labels: key.labels });
  }
  return cases;
}

export function createV5DefenseCase(spec, frozenCases = loadFrozenCases()) {
  const captured = frozenCases.get(`${spec.seed}/${spec.family}`);
  if (!captured) {
    throw new Error('unknown F4 v5 case');
  }
  const session = createCapturedDefenseSession(captured.batch, captured.labels);
  session.initial.task +=
    ' Each read tool is batch-wide; one call returns all 13 capture records. Do not pass capture_id.';
  session.initial.read_semantics =
    'One call to each read tool returns all 13 capture records with args {}.';
  session.initial.canonical_reads = [
    { tool: 'list-grants', args: {} },
    { tool: 'read-registry', args: {} },
    { tool: 'read-base-policy', args: {} },
    { tool: 'read-remediation', args: {} },
  ];
  session.step = (command) => stepCapturedDefense(session, command);
  return session;
}

export async function runCase(spec, options = {}) {
  if (!SEEDS.includes(spec.seed) || !FAMILIES.includes(spec.family)) {
    throw new Error('invalid F4 v5 seed or family');
  }
  const frozenCases = options.frozenCases ?? loadFrozenCases();
  const session = createV5DefenseCase(spec, frozenCases);
  if (options.mockReference) {
    const labels = Object.fromEntries(
      session.plane.grants.map((grant) => [grant.grant_id, session.reference(grant.grant_id)]),
    );
    session.step({ tool: 'submit', args: { labels } });
    const score = scoreCapturedDefense(session);
    return {
      spec,
      classification: score.success ? 'pass' : 'invalid_run',
      score,
      turns: 1,
      actions: 1,
    };
  }
  const config = options.config;
  if (!config?.endpoint || !config?.model || !config?.endpointId) {
    throw new Error('live F4 v5 case requires model, endpoint, and endpoint ID');
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(session.initial) },
  ];
  const transcript = [{ initial: session.initial, system_prompt: SYSTEM_PROMPT }];
  let actions = 0;
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await modelCall(messages, config, options.request);
    if (response.issue || response.finish_reason === 'length') {
      transcript.push({ response });
      return {
        spec,
        classification: response.issue ?? 'format_fail',
        reason: response.reason ?? 'truncated-response',
        score: scoreCapturedDefense(session),
        transcript,
        turns: turn + 1,
        actions,
      };
    }
    const commands = parseCommands(response.raw);
    if (!commands) {
      transcript.push({ response });
      return {
        spec,
        classification: 'format_fail',
        reason: 'no-json-tool-command',
        score: scoreCapturedDefense(session),
        transcript,
        turns: turn + 1,
        actions,
      };
    }
    const results = [];
    for (const command of commands) {
      if (actions >= MAX_ACTIONS) {
        return {
          spec,
          classification: 'model_fail',
          reason: 'action-budget-exhausted',
          score: scoreCapturedDefense(session),
          transcript,
          turns: turn + 1,
          actions,
        };
      }
      results.push(session.step(command));
      actions += 1;
      if (session.finished) {
        break;
      }
    }
    transcript.push({ response, commands, results });
    messages.push({ role: 'assistant', content: response.raw });
    messages.push({
      role: 'user',
      content: JSON.stringify(results.length === 1 ? results[0] : { results }),
    });
    if (session.finished) {
      const score = scoreCapturedDefense(session);
      return {
        spec,
        classification: score.success ? 'pass' : score.valid_output ? 'model_fail' : 'format_fail',
        score,
        transcript,
        turns: turn + 1,
        actions,
      };
    }
  }
  return {
    spec,
    classification: 'model_fail',
    reason: 'turn-budget-exhausted',
    score: scoreCapturedDefense(session),
    transcript,
    turns: MAX_TURNS,
    actions,
  };
}

function parseArgs(argv) {
  const args = {
    screen: false,
    mockReference: false,
    seed: 12021,
    family: FAMILIES[0],
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--screen') {
      args.screen = true;
    } else if (option === '--mock-reference') {
      args.mockReference = true;
    } else if (option === '--seed') {
      args.seed = Number(argv[++index]);
    } else if (option === '--family') {
      args.family = argv[++index];
    } else if (option === '--output') {
      args.output = argv[++index];
    } else {
      throw new Error(`unknown option ${option}`);
    }
  }
  if (!SEEDS.includes(args.seed) || !FAMILIES.includes(args.family)) {
    throw new Error('invalid F4 v5 case');
  }
  if (args.screen && (args.seed !== SEEDS[0] || args.family !== FAMILIES[0])) {
    throw new Error('--screen uses the frozen full grid');
  }
  return args;
}

function summarize(results, model, endpointId) {
  const counts = Object.fromEntries(
    ['pass', 'model_fail', 'format_fail', 'provider_error', 'invalid_run'].map((kind) => [
      kind,
      results.filter((result) => result.classification === kind).length,
    ]),
  );
  return {
    candidate: 'f4-chain-v5-captured-defense',
    model,
    endpoint_id: endpointId,
    prompt_sha256: sha(SYSTEM_PROMPT),
    total: results.length,
    ...counts,
    valid_output_batches: results.filter((result) => result.score.valid_output).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = {
    endpoint: process.env.CYBER_SUT_ENDPOINT || process.env.AWS_BASE_URL,
    endpointId: process.env.CYBER_ENDPOINT_ID,
    apiKey: process.env.CYBER_API_KEY || process.env.AWS_API_KEY,
    model: process.env.CYBER_MODEL,
  };
  if (
    !args.mockReference &&
    (!config.endpoint || !config.model || !config.endpointId || !args.output)
  ) {
    throw new Error('live F4 v5 run needs endpoint, model, endpoint ID, and output');
  }
  if (!args.mockReference && path.resolve(args.output).startsWith(`${process.cwd()}${path.sep}`)) {
    throw new Error('live raw output must be outside the repository');
  }
  if (
    args.screen &&
    !args.mockReference &&
    (config.model !== 'zai.glm-5' || config.endpointId !== 'aws-bedrock-mantle-ap-south-1')
  ) {
    throw new Error('frozen screen model/endpoint mismatch');
  }
  const frozenCases = loadFrozenCases();
  const grid = args.screen
    ? SEEDS.flatMap((seed) => FAMILIES.map((family) => ({ seed, family })))
    : [{ seed: args.seed, family: args.family }];
  const slots = Array(grid.length);
  let nextIndex = 0;
  const model = args.mockReference ? 'reference' : config.model;
  const endpointId = args.mockReference ? 'local' : config.endpointId;
  const workers = Array.from({ length: Math.min(CONCURRENCY, grid.length) }, async () => {
    while (nextIndex < grid.length) {
      const index = nextIndex++;
      const spec = grid[index];
      const result = await runCase(spec, {
        mockReference: args.mockReference,
        config,
        frozenCases,
      });
      slots[index] = result;
      process.stdout.write(`defense ${spec.seed}/${spec.family}: ${result.classification}\n`);
      if (args.output) {
        const completed = slots.filter(Boolean);
        fs.writeFileSync(
          args.output,
          `${JSON.stringify({ summary: summarize(completed, model, endpointId), results: completed }, null, 2)}\n`,
          { mode: 0o600 },
        );
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write(`${JSON.stringify(summarize(slots, model, endpointId))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
