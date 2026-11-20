#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFrozenCorpus } from './corpus.mjs';
import { runReference } from './reference.mjs';
import { runFrozenScreen, validateRawOutput } from './runner.mjs';
import { scoreResponse } from './scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  if (
    args.length !== 3 ||
    !['--mock-reference', '--live'].includes(args[0]) ||
    args[1] !== '--output'
  ) {
    throw new Error(
      'usage: screen.mjs (--mock-reference|--live) --output /absolute/private/raw.json',
    );
  }
  return { mode: args[0], output: args[2] };
}

function saveReference(output, result) {
  const destination = validateRawOutput(output);
  let handle;
  try {
    handle = fs.openSync(destination, 'wx', 0o600);
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(result, null, 2)}\n`);
    fs.fsyncSync(handle);
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

function referenceScreen(output) {
  const { manifest, cases } = readFrozenCorpus(here);
  const results = cases.map((item) => {
    const episode = {
      ...item.native,
      hidden: { revocation_lag_ticks: item.key.revocation_lag_ticks },
    };
    const reference = runReference(episode);
    return {
      case_id: item.id,
      spec: item.spec,
      classification: 'reference',
      score: scoreResponse(reference.session, item.key),
      turns: reference.turns,
      actions: reference.session.action_count,
      transcript: reference.transcript,
      errors: reference.transcript
        .filter((entry) => !entry.result.ok)
        .map((entry) => ({ command: entry.command, result: entry.result })),
      dynamic_events: reference.session.dynamic_events,
      deliveries: reference.session.delivery_records,
    };
  });
  saveReference(output, {
    task_id: manifest.task_id,
    manifest_sha256: createHash('sha256')
      .update(fs.readFileSync(path.join(here, 'manifest.json')))
      .digest('hex'),
    reference_only: true,
    completed_cases: results.length,
    results,
  });
  process.stdout.write(
    `Reference: ${results.filter((item) => item.score.exact).length}/${results.length} exact; saved private output.\n`,
  );
}

function waitForEnter(input = process.stdin) {
  return new Promise((resolve, reject) => {
    if (input.readableEnded || input.destroyed) {
      reject(new Error('first-case checkpoint: stdin ended'));
      return;
    }
    let line = '';
    const cleanup = () => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('close', onEnd);
      input.off('error', onError);
      input.pause();
    };
    const fail = (message) => {
      cleanup();
      reject(new Error(message));
    };
    const onData = (chunk) => {
      line += String(chunk);
      const newline = line.indexOf('\n');
      if (newline < 0) {
        if (line.length > 128) {
          fail('first-case checkpoint: input too long');
        }
        return;
      }
      const submitted = line.slice(0, newline).replace(/\r$/u, '');
      cleanup();
      if (submitted === '') {
        resolve();
      } else {
        reject(new Error('first-case checkpoint: press Enter without text'));
      }
    };
    const onEnd = () => fail('first-case checkpoint: stdin ended');
    const onError = () => fail('first-case checkpoint: stdin error');
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('close', onEnd);
    input.once('error', onError);
    input.resume();
  });
}

async function liveScreen(output) {
  const endpoint = process.env.CLOUDFLARE_OPENAI_BASE_URL;
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  let validEndpoint = false;
  try {
    const parsed = new URL(endpoint);
    validEndpoint = parsed.protocol === 'https:' && !parsed.search && !parsed.hash;
  } catch {
    // Keep the preflight error stable for an unset or malformed endpoint.
  }
  if (!validEndpoint || !apiKey) {
    throw new Error('live screen requires Cloudflare HTTPS endpoint and API key');
  }
  const result = await runFrozenScreen({
    root: here,
    output,
    endpoint,
    apiKey,
    onFirstCaseCheckpoint: async (checkpoint) => {
      const first = checkpoint.results[0];
      process.stdout.write(
        `First case saved: ${first.classification}; ${first.turns} turns; ${first.actions} actions. Inspect private output, then press Enter to continue.\n`,
      );
      await waitForEnter();
    },
  });
  const counts = Object.fromEntries(
    [...new Set(result.results.map((item) => item.classification))].map((classification) => [
      classification,
      result.results.filter((item) => item.classification === classification).length,
    ]),
  );
  process.stdout.write(
    `Scored screen: ${result.completed_cases}/36 attempted; ${JSON.stringify(counts)}.\n`,
  );
}

export async function main(args = process.argv.slice(2)) {
  const { mode, output } = parseArgs(args);
  if (mode === '--mock-reference') {
    referenceScreen(output);
  } else {
    await liveScreen(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'screen failed'}\n`);
    process.exitCode = 1;
  });
}
