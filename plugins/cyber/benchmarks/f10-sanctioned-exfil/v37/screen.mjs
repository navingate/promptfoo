#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { replay } from './adapter.mjs';

function normalize({ trace, terminal, ...rest }) {
  return {
    ...rest,
    trace: trace.map(({ sink_pid, ...step }) => ({
      ...step,
      ...(sink_pid ? { separate_sink_process: sink_pid !== process.pid } : {}),
    })),
    terminal: {
      ...terminal,
      remote_sink: terminal.remote_sink.map(({ writer_pid, ...receipt }) => ({
        ...receipt,
        separate_sink_process: writer_pid !== process.pid,
      })),
    },
  };
}

export async function screen() {
  const histories = [];
  for (const worker of ['v35-0', 'v35-1', 'ordinary-reference']) {
    for (const kind of ['overlap', 'distinct']) {
      histories.push(normalize(await replay({ seed: 76901, kind, worker })));
    }
  }
  return {
    schema_version: 'f10-v37-uncoached-remote-worker-model-free-screen-v1',
    seed: 76901,
    histories,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await screen();
  const evidence = path.join(import.meta.dirname, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(
    path.join(evidence, 'screen-results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      result.histories.map(({ worker, kind, terminal, score }) => ({
        worker,
        kind,
        recipient_copies: terminal.remote_sink.length,
        distinct_cells: terminal.distinct_cells,
        request_statuses: terminal.requests.map((request) => request.status),
        exact: score.exact,
      })),
    )}\n`,
  );
}
