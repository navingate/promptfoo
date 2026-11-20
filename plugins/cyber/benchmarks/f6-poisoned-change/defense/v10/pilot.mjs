import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCase, corpus, render, SYSTEM_PROMPT, score } from './chain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mode = process.argv[2] ?? 'pilot';
if (!['pilot', 'grid'].includes(mode)) {
  throw new Error('Use pilot or grid');
}
const selected = mode === 'pilot' ? [0, 1, 8, 9, 24, 25] : corpus().map((_, i) => i);
const outputDir = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'f6-v10-astra-'));
fs.mkdirSync(outputDir, { recursive: true });
const frozen = {
  source_sha256: sha256(path.join(here, 'chain.mjs')),
  upstream_v5_sha256: sha256(path.join(here, '../v5/chain.mjs')),
  protocol_sha256: sha256(path.join(here, 'PROTOCOL.md')),
  model: 'gpt-6.2-astra',
  cli: 'codex exec --ephemeral --sandbox read-only --ignore-user-config --ignore-rules',
  mode,
  case_indices: selected,
};
fs.writeFileSync(path.join(outputDir, 'freeze.json'), `${JSON.stringify(frozen, null, 2)}\n`);
const records = [];
for (const index of selected) {
  const spec = corpus()[index];
  const testCase = buildCase(spec);
  const input = `${SYSTEM_PROMPT}\n\n${render(testCase)}\n\nDo not use tools. Answer the change request as the defender now.`;
  const base = path.join(outputDir, `case-${String(index).padStart(2, '0')}`);
  fs.writeFileSync(`${base}.prompt.txt`, input);
  const response = spawnSync(
    'codex',
    [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--model',
      frozen.model,
      '--output-last-message',
      `${base}.response.txt`,
      '-',
    ],
    {
      input,
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  fs.writeFileSync(`${base}.stdout.txt`, response.stdout ?? '');
  fs.writeFileSync(`${base}.stderr.txt`, response.stderr ?? '');
  const raw = fs.existsSync(`${base}.response.txt`)
    ? fs.readFileSync(`${base}.response.txt`, 'utf8')
    : '';
  let result;
  if (response.error || response.status !== 0 || !raw) {
    result = {
      classification: 'provider_or_transport_error',
      reason: response.error?.message ?? `cli_exit_${response.status}`,
    };
  } else {
    try {
      const verdict = score(testCase, JSON.parse(raw));
      result = { classification: verdict.exact ? 'exact_success' : 'task_failure', ...verdict };
    } catch {
      result = {
        classification: 'task_failure',
        valid: false,
        exact: false,
        reason: 'non_json_model_output',
      };
    }
  }
  const record = {
    index,
    spec,
    prompt_sha256: sha256(`${base}.prompt.txt`),
    response_sha256: fs.existsSync(`${base}.response.txt`) ? sha256(`${base}.response.txt`) : null,
    ...result,
  };
  records.push(record);
  fs.writeFileSync(
    path.join(outputDir, 'results.json'),
    `${JSON.stringify({ frozen, records }, null, 2)}\n`,
  );
  process.stdout.write(
    `${index} ${JSON.stringify(spec)} ${record.classification} ${record.reason ?? ''}\n`,
  );
}
process.stdout.write(`${outputDir}\n`);
