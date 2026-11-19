#!/usr/bin/env node
// Fresh F4 offense transport wrapper; the native v3 runner owns prompts, tools, and scoring.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../shared/estate.mjs';
import { auditFetch, combineAudit, hash, parseJsonOrNull } from './audit.mjs';
import { REQUEST_SETTINGS, SEEDS } from './config.mjs';
import { classifyCase, summarize } from './result.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const runnerPath = path.resolve(here, '../chain-v3/runner.mjs');
const scoredPreloadPath = path.resolve(here, '../chain-cloudflare-v3/offense-preload.mjs');
const manifestPath = path.join(here, 'manifest.json');
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
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

function validateOutput(output) {
  if (typeof output !== 'string' || !output.trim()) {
    throw new Error('F4 offense screen requires --output');
  }
  const resolved = path.resolve(output);
  const canonicalRoot = fs.realpathSync.native(repoRoot);
  const canonicalParent = fs.realpathSync.native(path.dirname(resolved));
  if (
    inside(canonicalRoot, resolved) ||
    inside(canonicalRoot, path.join(canonicalParent, path.basename(resolved))) ||
    gitCheckoutAncestor(canonicalParent)
  ) {
    throw new Error('raw screen output must be outside the repository');
  }
  if (fs.existsSync(resolved)) {
    const existing = fs.realpathSync.native(resolved);
    if (inside(canonicalRoot, existing) || gitCheckoutAncestor(path.dirname(existing))) {
      throw new Error('raw screen output must be outside the repository');
    }
  }
  return resolved;
}

function cloudflareConfig(env) {
  const endpoint = env?.CLOUDFLARE_OPENAI_BASE_URL?.replace(/\/+$/u, '');
  const apiKey = env?.CLOUDFLARE_API_KEY;
  if (!endpoint || !apiKey || new URL(endpoint).protocol !== 'https:') {
    throw new Error('F4 offense screen requires Cloudflare HTTPS endpoint and key');
  }
  return { endpoint, apiKey, model: REQUEST_SETTINGS.model_id };
}

async function verifyManifest(mockReference, injectedChild) {
  if (!fs.existsSync(manifestPath)) {
    if (!mockReference && !injectedChild) {
      throw new Error('F4 offense manifest must be frozen before live requests');
    }
    return null;
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { verifySourceBindings } = await import('./preflight.mjs');
  verifySourceBindings(manifest);
  return hash(manifestBytes);
}

function childEnvironment(config, auditFile, mockReference) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: os.tmpdir(),
  };
  if (mockReference) {
    return env;
  }
  return {
    ...env,
    CLOUDFLARE_OPENAI_BASE_URL: config.endpoint,
    CLOUDFLARE_API_KEY: config.apiKey,
    CYBER_SUT_ENDPOINT: config.endpoint,
    CYBER_API_KEY: config.apiKey,
    CYBER_MODEL: config.model,
    CYBER_ENDPOINT_ID: REQUEST_SETTINGS.endpoint_id,
    F4_CF_SCORE_PRELOAD: '1',
    F4_V18_AUDIT_PRELOAD: '1',
    F4_V18_AUDIT_FILE: auditFile,
  };
}

function childArguments(spec, outputFile, mockReference) {
  return [
    ...(mockReference
      ? []
      : [`--import=${path.join(here, 'audit.mjs')}`, `--import=${scoredPreloadPath}`]),
    runnerPath,
    '--mode',
    'offense',
    '--seeds',
    String(spec.seed),
    '--families',
    spec.family,
    '--output',
    outputFile,
    ...(mockReference ? ['--mock-reference'] : []),
  ];
}

async function spawnNativeCase({ args, env, outputFile, auditFile }) {
  const { exitCode, stderr } = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8192) {
        stderr += chunk.slice(0, 8192 - stderr.length);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code, stderr }));
  });
  const capture = fs.existsSync(outputFile)
    ? parseJsonOrNull(fs.readFileSync(outputFile, 'utf8'))
    : null;
  const audit = fs.existsSync(auditFile)
    ? fs
        .readFileSync(auditFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => parseJsonOrNull(line))
    : [];
  return { exitCode, stderr, capture, audit };
}

function persist(output, summary, results) {
  const temporary = `${output}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify({ summary, results }, null, 2)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export async function runScreen(options = {}) {
  const output = validateOutput(options.output);
  const mockReference = options.mockReference === true;
  const injectedChild = typeof options.spawnCase === 'function';
  const manifestSha256 = await verifyManifest(mockReference, injectedChild);
  const config = mockReference ? null : cloudflareConfig(options.env ?? process.env);
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const spawnCase = options.spawnCase ?? spawnNativeCase;
  const request = options.request;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-v18-offense-'));
  fs.chmodSync(tempDir, 0o700);
  const results = [];
  let lastStart = null;
  let lastObservedStart = null;
  try {
    for (const [index, spec] of SEEDS.flatMap((seed) =>
      FAMILIES.map((family) => ({ seed, family })),
    ).entries()) {
      if (!mockReference && lastStart !== null) {
        const remaining = REQUEST_SETTINGS.minimum_request_start_gap_ms - (clock() - lastStart);
        if (remaining > 0) {
          await sleep(remaining);
        }
      }
      const outputFile = path.join(tempDir, `case-${index}.json`);
      const auditFile = path.join(tempDir, `audit-${index}.jsonl`);
      fs.writeFileSync(auditFile, '', { flag: 'wx', mode: 0o600 });
      const localEvents = [];
      let localSequence = 0;
      const auditedRequest = async (url, init) => {
        if (lastStart !== null) {
          const remaining = REQUEST_SETTINGS.minimum_request_start_gap_ms - (clock() - lastStart);
          if (remaining > 0) {
            await sleep(remaining);
          }
        }
        lastStart = clock();
        return await auditFetch(
          request,
          url,
          init,
          () => lastStart,
          (event) => localEvents.push(event),
          ++localSequence,
        );
      };
      let child;
      try {
        child = await spawnCase({
          spec,
          args: childArguments(spec, outputFile, mockReference),
          env: childEnvironment(config, auditFile, mockReference),
          outputFile,
          auditFile,
          request: auditedRequest,
        });
      } catch {
        child = { exitCode: null, capture: null, audit: [], stderr: '' };
      }
      let audit;
      try {
        audit = combineAudit([...localEvents, ...(child?.audit ?? [])]);
      } catch {
        audit = [];
      }
      if (audit.length > 0) {
        lastStart = Math.max(
          lastStart ?? Number.NEGATIVE_INFINITY,
          ...audit.map((entry) => entry.started_ms),
        );
      }
      const result = classifyCase(spec, child, audit, mockReference, lastObservedStart);
      if (audit.length > 0) {
        lastObservedStart = audit.at(-1).started_ms;
      }
      results.push(result);
      const summary = summarize(results, manifestSha256);
      persist(output, summary, results);
      log(`offense ${spec.seed}/${spec.family}: ${result.classification}`);
      if (['provider_error', 'invalid_run'].includes(result.classification)) {
        break;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const summary = summarize(results, manifestSha256);
  log(
    JSON.stringify({
      attempted: summary.attempted,
      parseable: summary.parseable,
      scorable: summary.scorable,
      exact: summary.exact,
      format_fail: summary.format_fail,
      provider_error: summary.provider_error,
      invalid_run: summary.invalid_run,
    }),
  );
  return { summary, results };
}

function parseArgs(argv) {
  const args = { mockReference: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mock-reference') {
      args.mockReference = true;
    } else if (argv[index] === '--output') {
      args.output = argv[++index];
    } else {
      throw new Error(`unknown option ${argv[index]}`);
    }
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScreen(parseArgs(process.argv.slice(2)))
    .then(({ summary }) => {
      if (!summary.screen_complete || summary.invalid_run || summary.provider_error) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
