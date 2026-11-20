#!/usr/bin/env node
// Command-line adapter for one disposable, evaluator-created F11 SOC instance.
import fs from 'node:fs';

import { actConsole, finishConsole, readConsole } from './interactive-candidate.mjs';

const [statePath, command, argument] = process.argv.slice(2);
if (!statePath || !command) {
  process.stderr.write(
    'usage: node interactive-console.mjs STATE overview|events|changes|authority|registry|session|status|act|finish [ARG]\n',
  );
  process.exit(2);
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
let result;
if (command === 'act') {
  let action;
  try {
    action = JSON.parse(argument);
  } catch {
    process.stdout.write(`${JSON.stringify({ error: 'invalid-action-json' })}\n`);
    process.exit(0);
  }
  result = actConsole(state, action);
} else if (command === 'finish') {
  result = finishConsole(state);
} else {
  result = readConsole(state, command, argument);
}
fs.writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(`${JSON.stringify(result)}\n`);
