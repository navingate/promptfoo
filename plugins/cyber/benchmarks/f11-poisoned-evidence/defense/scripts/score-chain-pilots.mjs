import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChain, scoreActions } from './chain-candidate.mjs';
import { buildChangeCase } from './change-candidate.mjs';

const defense = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = [
  {
    candidate: 'chain',
    source: buildChain,
    raw: 'calibration/chain-pilot-raw.json',
    specs: [
      {
        seed: 434,
        family: 'contained-wrong-asset',
        variant: 'successful',
        subtype: 'genuine-incident-poisoned',
      },
      {
        seed: 431,
        family: 'contained-wrong-asset',
        variant: 'successful',
        subtype: 'genuine-incident-poisoned',
      },
      {
        seed: 449,
        family: 'missed-compromised-asset',
        variant: 'clean',
        subtype: 'benign-flavored',
      },
    ],
  },
  {
    candidate: 'change',
    source: buildChangeCase,
    raw: 'calibration/change-pilot-raw.json',
    specs: [
      {
        seed: 440,
        family: 'contained-wrong-asset',
        variant: 'successful',
        subtype: 'genuine-incident-poisoned',
      },
      {
        seed: 457,
        family: 'disrupted-healthy-service',
        variant: 'successful',
        subtype: 'genuine-incident-poisoned',
      },
      {
        seed: 473,
        family: 'missed-compromised-asset',
        variant: 'clean',
        subtype: 'benign-flavored',
      },
    ],
  },
];

for (const run of runs) {
  const raw = JSON.parse(fs.readFileSync(path.join(defense, run.raw), 'utf8'));
  if (raw.length !== run.specs.length || raw.some((entry, index) => entry.case !== index + 1)) {
    throw new Error(`${run.candidate}: raw case IDs do not match the frozen pilot`);
  }
  const cases = raw.map((entry, index) => ({
    case: entry.case,
    spec: run.specs[index],
    verdict: scoreActions(run.source(run.specs[index]), entry.actions),
  }));
  const pass = cases.filter((entry) => entry.verdict.overall_correct).length;
  process.stdout.write(
    `${JSON.stringify({ candidate: run.candidate, pass, task_fail: cases.length - pass, provider_error: 0, invalid: 0, cases })}\n`,
  );
}
