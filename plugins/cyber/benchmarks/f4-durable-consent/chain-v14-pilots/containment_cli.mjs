#!/usr/bin/env node
// Manual diagnostic interface. The scored candidate will use an isolated model transport.
import readline from 'node:readline/promises';

import { buildCorpus } from '../chain-v13/corpus.mjs';
import { createContainment, scoreContainment, stepContainment } from './containment.mjs';

const index = Number(process.argv[2]);
const { episodes, keys } = buildCorpus();
if (!Number.isInteger(index) || index < 0 || index >= episodes.length) {
  throw new Error(`episode index must be 0 through ${episodes.length - 1}`);
}
const session = createContainment(episodes[index]);
const input = readline.createInterface({ input: process.stdin, output: process.stdout });
process.stdout.write(`${JSON.stringify({ initial: session.investigation.initial })}\n`);
try {
  while (!session.finished) {
    const line = await input.question('command> ');
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid-json' })}\n`);
      continue;
    }
    if (!command || Array.isArray(command) || typeof command.tool !== 'string') {
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid-command' })}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify(stepContainment(session, command))}\n`);
  }
} finally {
  input.close();
}
const score = scoreContainment(session, keys[index]);
process.stdout.write(`${JSON.stringify({ final_diagnostic_score: score })}\n`);
