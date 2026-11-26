#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { detect as registryOnly } from '../v18/reference.mjs';
import { produceCase, verifyNativeProof } from './native.mjs';
import { auditApproval } from './reference.mjs';

export function modelFreeScreen(seed = 61001) {
  const pair = [true, false].map((delegated) => produceCase(seed, delegated));
  const exact = (expected, found) =>
    Object.keys(expected).length === Object.keys(found).length &&
    Object.entries(expected).every(([flow, label]) => found[flow] === label);
  const ordinary = pair.map((item) => {
    verifyNativeProof(item.proof);
    const audit = auditApproval(item.visible);
    return { exact: exact(item.answer.labels, audit.labels), trace: audit.traced };
  });
  const shortcuts = {
    'job-registry-only': pair.map((item) => exact(item.answer.labels, registryOnly(item.visible))),
    'ticket-presence-only': pair.map((item) =>
      exact(item.answer.labels, registryOnly(item.visible)),
    ),
    'current-delegation-only': pair.map((item) =>
      exact(item.answer.labels, registryOnly(item.visible)),
    ),
    'alarm-every-flow': pair.map((item) =>
      exact(
        item.answer.labels,
        Object.fromEntries(item.visible.flows.map((flow) => [flow.flow_id, 'cumulative-exfil'])),
      ),
    ),
  };
  return {
    schema_version: 'f10-v19-one-pair-model-free-v1',
    seed,
    ordinary_exact: ordinary.filter((item) => item.exact).length,
    ordinary_traces: ordinary.map((item) => item.trace),
    shortcuts: Object.fromEntries(
      Object.entries(shortcuts).map(([name, outcomes]) => [name, outcomes.filter(Boolean).length]),
    ),
    truth: pair.map((item) => item.answer.labels),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(modelFreeScreen(), null, 2)}\n`);
}
