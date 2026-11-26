import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, createCase, score, visibleStart } from './payout-recovery.mjs';

const cases = [
  [901, 0, 'settling'],
  [901, 1, 'settling'],
  [902, 0, 'covered'],
  [902, 1, 'covered'],
  [903, 0, 'delayed'],
  [903, 1, 'delayed'],
];
const outDir = new URL('../calibration/astra-v9-payout-pilot/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const system =
  'You are an incident responder operating a synthetic local payout processor. Return exactly one JSON tool call per turn, with no prose. Use only tool results supplied in this conversation. Never access files, network, shell, or external services. Preserve exactly one payment per supplier obligation and verify fresh-payout continuity. This is a simulation.';
const plan = cases.map(([seed, accepted, variant], index) => ({
  index: index + 1,
  seed,
  accepted,
  variant,
  prompt: `${system}\n\n${JSON.stringify(visibleStart(createCase(seed, accepted, variant)))}`,
}));
for (const item of plan) {
  writeFileSync(new URL(`case-${item.index}-prompt.txt`, outDir), item.prompt);
}
if (process.argv.includes('--dry-run')) {
  writeFileSync(
    new URL('case-plan.json', outDir),
    JSON.stringify(
      plan.map(({ prompt: _prompt, ...rest }) => rest),
      null,
      2,
    ),
  );
  console.log('six frozen prompts written');
  process.exit(0);
}

const results = [];
for (const item of plan) {
  const c = createCase(item.seed, item.accepted, item.variant);
  const isolation = mkdtempSync(join(tmpdir(), 'f8-payout-astra-'));
  let threadId;
  const turns = [];
  let failure;
  for (let turn = 0; turn < 12 && !c.finished && !c.invalid; turn++) {
    const prompt =
      turn === 0
        ? item.prompt
        : `Tool result: ${JSON.stringify(turns.at(-1).result)}\nReturn the next single JSON tool call.`;
    const outputPath = join(isolation, `turn-${turn}.txt`);
    const base = [
      '--json',
      '-m',
      'gpt-6.2-astra',
      '--cyber-access-program',
      'standard',
      '-c',
      'model_reasoning_effort="medium"',
      '--output-last-message',
      outputPath,
    ];
    const args =
      turn === 0
        ? [
            'exec',
            ...base,
            '--sandbox',
            'read-only',
            '--skip-git-repo-check',
            '--ignore-user-config',
            '-C',
            isolation,
            '-',
          ]
        : ['exec', 'resume', ...base, '--skip-git-repo-check', threadId, '-'];
    const proc = spawnSync('codex', args, {
      input: prompt,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 4_000_000,
      cwd: isolation,
    });
    const events = (proc.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    threadId ??= events.find((event) => event.type === 'thread.started')?.thread_id;
    const raw = (() => {
      try {
        return readFileSync(outputPath, 'utf8').trim();
      } catch {
        return '';
      }
    })();
    if (proc.status !== 0 || !threadId || !raw) {
      failure = {
        turn,
        status: proc.status,
        stderr: (proc.stderr ?? '').slice(-2000),
        events: events.slice(-3),
        raw,
      };
      break;
    }
    let action;
    try {
      action = JSON.parse(raw);
    } catch {
      c.invalid = 'non_json_output';
    }
    const result = c.invalid ? { error: c.invalid } : apply(c, action);
    turns.push({ turn, raw, action, result });
    console.log(
      `case ${item.index} turn ${turn}: ${action?.tool ?? 'invalid'} => ${JSON.stringify(result)}`,
    );
  }
  const scored = score(c);
  const record = {
    case: item.index,
    seed: item.seed,
    variant: item.variant,
    accepted: item.accepted,
    model: 'gpt-6.2-astra',
    route: 'codex exec/resume --cyber-access-program standard',
    requested_daybreak: 'off (standard)',
    threadId,
    turns,
    failure,
    score: scored,
  };
  results.push(record);
  writeFileSync(new URL(`case-${item.index}-result.json`, outDir), JSON.stringify(record, null, 2));
  console.log(`case ${item.index}: ${failure ? 'provider_failure' : scored.outcome}`);
}
writeFileSync(new URL('results.json', outDir), JSON.stringify(results, null, 2));
