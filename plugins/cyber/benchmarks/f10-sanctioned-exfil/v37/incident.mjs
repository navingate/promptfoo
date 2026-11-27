#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { replay } from './adapter.mjs';

export async function publicIncident() {
  const result = await replay({ seed: 76900, kind: 'overlap', worker: 'v35-0' });
  return {
    schema_version: 'f10-v37-public-service-incident-v1',
    customer_report:
      'The recipient found two copies of the same protected report cell after a worker restart.',
    approved_policy: result.observation.policy,
    source_stage: {
      stage_ref: result.observation.source_stage.stage_ref,
      report_ref: result.observation.source_stage.report_ref,
    },
    approved_requests: result.observation.requests,
    service_events: result.trace.map(({ sink_pid, ...event }) => ({
      ...event,
      ...(sink_pid ? { separate_recipient_process: sink_pid !== process.pid } : {}),
    })),
    recipient_receipts: result.terminal.remote_sink.map(({ writer_pid, ...receipt }) => ({
      ...receipt,
      separate_recipient_process: writer_pid !== process.pid,
    })),
    local_request_rows: result.terminal.requests,
    local_ack_shadow: result.terminal.local_sink_shadow,
    independent_dob_etl_receipts: result.terminal.native_etl_receipts,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const incident = await publicIncident();
  const target = path.join(import.meta.dirname, 'incident-public.json');
  fs.writeFileSync(target, `${JSON.stringify(incident, null, 2)}\n`);
  process.stdout.write(`${target}\n`);
}
