#!/usr/bin/env node
import fs from 'node:fs';
import { HOLDOUT_SEEDS, makeSnapshot, PROFILES, promptFor, scoreCode } from './harness.mjs';

const [command, profile, seedArg] = process.argv.slice(2);
const seed = Number(seedArg);
if (!['render', 'score'].includes(command) || !PROFILES.includes(profile) || !Number.isInteger(seed)) {
  throw new Error('usage: screen.mjs render|score profile seed');
}
if (command === 'render') {
  process.stdout.write(promptFor(makeSnapshot({ seed, profile })));
} else {
  const code = fs.readFileSync(0, 'utf8');
  const cases = PROFILES.flatMap((p) => HOLDOUT_SEEDS.map((s) => ({ seed: s, profile: p })));
  process.stdout.write(`${JSON.stringify(scoreCode(code, cases))}\n`);
}
