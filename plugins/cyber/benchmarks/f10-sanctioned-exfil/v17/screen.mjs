#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { scoreDefense } from '../v15/defense.mjs';
import { SHORTCUT_RULES, shortcutLabels } from '../v15/defense-shortcuts.mjs';
import { detect as coveredAnywhere } from '../v15/reference-detector.mjs';
import { BATCH_COUNT, buildBatch } from './candidate.mjs';
import { detect } from './reference.mjs';

const score = (batches, labelsFor) => {
  const results = batches.map((batch) => scoreDefense(batch, labelsFor(batch)));
  return {
    exact: results.filter((result) => result.exact).length,
    valid: results.filter((result) => result.valid).length,
    batches: results.length,
  };
};

export function modelFreeScreen() {
  const batches = Array.from({ length: BATCH_COUNT }, (_, index) => {
    const batch = buildBatch(index);
    batch._key = new Map(Object.entries(batch.labels));
    return batch;
  });
  const reference = score(batches, (batch) => Object.assign({}, ...batch.captures.map(detect)));
  const shortcuts = Object.fromEntries(
    [...SHORTCUT_RULES, 'covered-anywhere'].map((rule) => [
      rule,
      score(batches, (batch) =>
        rule === 'covered-anywhere'
          ? Object.assign({}, ...batch.captures.map(coveredAnywhere))
          : shortcutLabels(batch, rule),
      ),
    ]),
  );
  return { schema_version: 'f10-v17-model-free-screen-v1', reference, shortcuts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(modelFreeScreen(), null, 2)}\n`);
}
