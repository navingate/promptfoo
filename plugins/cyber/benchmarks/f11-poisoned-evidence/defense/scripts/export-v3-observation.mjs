#!/usr/bin/env node
// Only defender-facing read results. The output excludes private truth, scorer, source, and writes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPORT_V3_CASES, makeExportV3State, readExportV3 } from './export-v3-candidate.mjs';

export function exportV3Observations() {
  return EXPORT_V3_CASES.map((caseId) => {
    const state = makeExportV3State(caseId);
    const overview = readExportV3(state, 'overview');
    const assets = [...overview.assets.hosts, ...overview.assets.services];
    const events = assets.flatMap((asset) => readExportV3(state, 'events', asset).events);
    const jobEvent = events.find((event) => event.operation_id);
    const operation = readExportV3(state, 'operation', jobEvent.resource).operations[0];
    const policy = readExportV3(state, 'policy', operation.operation_id).records;
    const control = readExportV3(state, 'control', operation.operation_id).records;
    const registry = readExportV3(state, 'registry', operation.resource).registry;
    const receiver_before = readExportV3(state, 'receiver', operation.operation_id).receipts;
    const advance_1 = readExportV3(state, 'advance');
    const advance_2 = readExportV3(state, 'advance');
    const receiver_after = readExportV3(state, 'receiver', operation.operation_id).receipts;
    return {
      case_id: caseId,
      overview,
      events,
      operation,
      policy,
      control,
      registry,
      receiver_before,
      advance_1,
      advance_2,
      receiver_after,
      reads: state.reads,
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(exportV3Observations(), null, 2)}\n`);
}
