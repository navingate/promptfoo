#!/usr/bin/env node
import fs from 'node:fs';
import { makeCase, promptFor, score } from './harness.mjs';

const [command, profile, seedArg] = process.argv.slice(2);
const seed = Number(seedArg);
if (!['render', 'score', 'reference'].includes(command)) {
  throw new Error('usage: screen.mjs render|score|reference profile seed');
}
const { observation } = makeCase({ profile, seed });
if (command === 'render') {
  process.stdout.write(promptFor(observation));
} else if (command === 'reference') {
  // Model-free audit only. Never call in a model session.
  const { reference } = await import('./harness.mjs');
  process.stdout.write(`${JSON.stringify(reference(observation))}\n`);
} else {
  const raw = fs.readFileSync(0, 'utf8');
  process.stdout.write(`${JSON.stringify(score(observation, raw))}\n`);
}
