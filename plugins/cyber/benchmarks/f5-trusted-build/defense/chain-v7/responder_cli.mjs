#!/usr/bin/env node
import readline from 'node:readline';
import { initial, makeIncident, resolveCaseToken, step } from './estate.mjs';

const [opaqueCase] = process.argv.slice(2);
const { profile, seed } = resolveCaseToken(opaqueCase);
const estate = makeIncident({ profile, seed });
process.stdout.write(`${JSON.stringify(initial(estate))}\n`);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let command;
  try { command = JSON.parse(line); }
  catch { process.stdout.write('{"error":"invalid-json-command"}\n'); continue; }
  const response = step(estate, command);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  if (command.op === 'submit') {
    input.close();
    process.stdin.pause();
    break;
  }
}
