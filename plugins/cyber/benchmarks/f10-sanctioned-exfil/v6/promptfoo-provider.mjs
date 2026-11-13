// One Promptfoo test invokes one native F10 seed; the native runner remains the scorer.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CAPTURE_SEEDS } from './capture-producer.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

export function oneCaseArgs(config, output) {
  const mode = config?.mode;
  const seed = Number(config?.seed);
  if (!['offense', 'defense'].includes(mode) || !Number.isSafeInteger(seed) || seed < 1) {
    throw new Error('F10 provider requires a mode and one positive integer seed');
  }
  if (mode === 'defense' && !CAPTURE_SEEDS.includes(seed)) {
    throw new Error('F10 defense seed must be one of the vendored captures');
  }
  const mock = config.mockReference === true;
  const script = path.join(here, mode === 'offense' ? '../v5/runner.mjs' : 'defense-runner.mjs');
  const args = [script, '--seeds', String(seed), '--output', output];
  if (mode === 'offense') {
    args.push('--mode', 'offense', '--families', 'multi-identity-fanout', '--concurrency', '1');
  }
  if (mock) {
    args.push('--mock-reference');
  }
  return { mode, seed, mock, args };
}

export default class F10OneCaseProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? `f10-v6-${this.config.mode ?? 'unknown'}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-promptfoo-'));
    fs.chmodSync(directory, 0o700);
    const output = path.join(directory, 'native-result.json');
    try {
      const { mode, seed, mock, args } = oneCaseArgs(this.config, output);
      const timeout = mode === 'offense' ? 3700000 : 1300000;
      await execFileAsync(process.execPath, args, {
        cwd: path.resolve(here, '../../../../..'),
        timeout,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const capture = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (capture.results.length !== 1) {
        throw new Error('native runner returned more than one case');
      }
      const result = capture.results[0];
      if ((mode === 'offense' ? result.spec?.seed : result.seed) !== seed) {
        throw new Error('native runner returned the wrong seed');
      }
      return {
        output: result.classification,
        metadata: {
          mode,
          seed,
          model: capture.summary.model,
          endpoint_id: capture.summary.endpoint_id,
          mock_reference: mock,
          native_classification: result.classification,
          native_score: result.score ?? null,
          native_valid:
            mode === 'defense'
              ? (result.score?.valid ?? false)
              : ['pass', 'model_fail'].includes(result.classification),
          native_reason: result.reason ?? null,
          native_error: ['provider_error', 'invalid_run'].includes(result.classification)
            ? (result.reason ?? result.classification)
            : null,
        },
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}
