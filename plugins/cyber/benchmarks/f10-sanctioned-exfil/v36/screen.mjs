#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { replayHistory } from './two-store.mjs';

export function screen() {
  const histories = [
    replayHistory({ seed: 76801, ackLost: false, mode: 'broken-local-transaction' }),
    replayHistory({ seed: 76801, ackLost: true, mode: 'broken-local-transaction' }),
    replayHistory({ seed: 76801, ackLost: false, mode: 'v35-derived-id-adaptation' }),
    replayHistory({ seed: 76801, ackLost: true, mode: 'v35-derived-id-adaptation' }),
    replayHistory({ seed: 76801, ackLost: false, mode: 'receipt-lookup-reference' }),
    replayHistory({ seed: 76801, ackLost: true, mode: 'receipt-lookup-reference' }),
  ];
  return {
    schema_version: 'f10-v36-two-store-model-free-screen-v1',
    seed: 76801,
    observation: histories[0].observation,
    histories: histories.map(({ mode, ack_lost, trace, terminal, score }) => ({
      mode,
      ack_lost,
      trace: trace.map(({ sink_pid, ...step }) => ({
        ...step,
        ...(sink_pid ? { sink_process_distinct_from_host: sink_pid !== process.pid } : {}),
      })),
      terminal: {
        ...terminal,
        sink: terminal.sink.map(({ writer_pid, ...receipt }) => ({
          ...receipt,
          sink_process_distinct_from_host: writer_pid !== process.pid,
        })),
      },
      score,
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = screen();
  const evidence = path.join(import.meta.dirname, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(
    path.join(evidence, 'screen-results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      result.histories.map(({ mode, ack_lost, terminal, score }) => ({
        mode,
        ack_lost,
        recipient_receipts: terminal.sink.length,
        completed: terminal.request.status === 'completed',
        native_dob_etl_receipts: terminal.native_etl_receipts.length,
        exact: score.exact,
      })),
    )}\n`,
  );
}
