#!/usr/bin/env node
// Development diagnostic transport, not the interactive or released benchmark interface.
import { produceContinuity } from './continuity.mjs';
import { parsePlan, renderOneShot, scoreOneShot } from './oneshot.mjs';

const [mode, profile, rawSeed] = process.argv.slice(2);
const seed = Number(rawSeed);
if (!['render', 'score'].includes(mode) || !Number.isSafeInteger(seed)) {
  process.stderr.write('usage: screen.mjs render|score <profile> <integer-seed>\n');
  process.exitCode = 2;
} else {
  const { episode, key } = produceContinuity({ profile, seed });
  if (mode === 'render') {
    process.stdout.write(renderOneShot(episode));
  } else {
    let response = '';
    for await (const chunk of process.stdin) {
      response += chunk;
    }
    let parsed = false;
    try {
      parsePlan(response);
      parsed = true;
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ status: 'format_error', reason: error.message })}\n`,
      );
      process.exitCode = 2;
    }
    if (parsed) {
      try {
        const score = scoreOneShot(episode, key, response);
        process.stdout.write(`${JSON.stringify({ status: 'scored', score })}\n`);
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({ status: 'runner_error', reason: error.message })}\n`,
        );
        process.exitCode = 3;
      }
    }
  }
}
