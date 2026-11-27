import { fileURLToPath } from 'node:url';

import { replayCase } from './native.mjs';
import { scoreTerminal } from './scorer.mjs';

export function screen(seed = 76701) {
  const cases = {};
  for (const kind of ['distinct', 'overlap']) {
    const runs = {};
    for (const mode of ['broken-concurrent', 'broken-serial', 'safe-atomic']) {
      const replay = replayCase(seed, kind, mode);
      runs[mode] = {
        score: scoreTerminal(replay),
        trace: replay.trace,
        terminal: replay.terminal,
      };
    }
    cases[kind] = {
      observation: replayCase(seed, kind, 'safe-atomic').observation,
      runs,
    };
  }
  return { schema_version: 'f10-v34-sqlite-release-worker-g0-screen-v1', seed, cases };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}
