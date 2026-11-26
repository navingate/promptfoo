#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { produceCase, verifyNativeProof } from './native.mjs';
import { auditEndToEnd } from './reference.mjs';

export function modelFreeScreen(seed = 61001) {
  const pair = [true, false].map((authorized) => produceCase(seed, authorized));
  const ordinary = pair.map((item) => {
    assert.equal(verifyNativeProof(item.proof), true);
    const audit = auditEndToEnd(item.visible);
    return {
      exact:
        JSON.stringify(audit.source_labels) === JSON.stringify(item.answer.source_labels) &&
        JSON.stringify(audit.downstream_labels) === JSON.stringify(item.answer.downstream_labels),
      trace: audit.trace,
    };
  });
  const sourceOnly = pair.map((item) => {
    const labels = Object.fromEntries(
      item.visible.downstream_flows.map((flow) => [flow.flow_id, 'sanctioned-bulk']),
    );
    return JSON.stringify(labels) === JSON.stringify(item.answer.downstream_labels);
  });
  const currentGrant = pair.map((item) => {
    const copy = structuredClone(item.visible);
    copy.downstream_grants = copy.downstream_grants.map((grant) => ({
      ...grant,
      effective_at: 0,
    }));
    return (
      JSON.stringify(auditEndToEnd(copy).downstream_labels) ===
      JSON.stringify(item.answer.downstream_labels)
    );
  });
  const alarmAll = pair.map((item) => {
    const labels = Object.fromEntries(
      item.visible.downstream_flows.map((flow) => [flow.flow_id, 'cumulative-exfil']),
    );
    return JSON.stringify(labels) === JSON.stringify(item.answer.downstream_labels);
  });
  return {
    schema_version: 'f10-v20-one-pair-model-free-v1',
    seed,
    ordinary_exact: ordinary.filter((item) => item.exact).length,
    traces: ordinary.map((item) => item.trace),
    shortcuts: {
      'source-job-only': sourceOnly.filter(Boolean).length,
      'current-grant-only': currentGrant.filter(Boolean).length,
      'alarm-every-downstream-flow': alarmAll.filter(Boolean).length,
    },
    truth: pair.map((item) => item.answer),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(modelFreeScreen(), null, 2)}\n`);
}
