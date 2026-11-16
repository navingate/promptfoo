#!/usr/bin/env node
// Development-only manual transport for blind Astra diagnostics.
import readline from 'node:readline/promises';

import { createCampaign, produceCampaign, scoreCampaign, stepCampaign } from './campaign.mjs';

const profile = process.argv[2];
const seed = Number(process.argv[3]);
const { episode, key } = produceCampaign({ seed, profile });
const session = createCampaign(episode);
const input = readline.createInterface({ input: process.stdin, output: process.stdout });
process.stdout.write(`${JSON.stringify({ initial: session.initial })}\n`);
try {
  while (!session.finished) {
    const raw = await input.question('command> ');
    let commands;
    try {
      const parsed = JSON.parse(raw);
      commands = Array.isArray(parsed) ? parsed : [parsed];
      if (
        commands.length < 1 ||
        commands.length > 8 ||
        commands.some((item) => !item || Array.isArray(item) || typeof item.tool !== 'string')
      ) {
        throw new Error('invalid command array');
      }
    } catch {
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid-json-command' })}\n`);
      continue;
    }
    const results = [];
    for (const command of commands) {
      results.push(stepCampaign(session, command));
      if (session.finished) {
        break;
      }
    }
    process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : { results })}\n`);
  }
} finally {
  input.close();
}
process.stdout.write(
  `${JSON.stringify({ final_diagnostic_score: scoreCampaign(session, key) })}\n`,
);
