#!/usr/bin/env node
// Model-free baselines; no evaluator label is supplied to a classifier.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeBatch } from '../chain-v4/capture.mjs';
import { loadFrozenCases } from './runner.mjs';

export function auditShortcuts() {
  const cases = [...loadFrozenCases().values()];
  const positions = Array(13).fill(0);
  let firstPostResetAccess = 0;
  let accessTruePositives = 0;
  let accessFalseAlarms = 0;
  for (const { batch, labels } of cases) {
    const grants = normalizeBatch(batch).grants;
    const malicious = (grant) => labels[grant.grant_id] === 'malicious-missed-by-query';
    positions[grants.findIndex(malicious)] += 1;
    const accessed = grants.filter((grant) => grant.accessed_post_reset);
    firstPostResetAccess += Number(malicious(accessed[0]));
    accessTruePositives += accessed.filter(malicious).length;
    accessFalseAlarms += accessed.filter((grant) => !malicious(grant)).length;
  }
  return {
    cases: cases.length,
    fixed_position_best_of_13: Math.max(...positions),
    fixed_position_distribution: positions,
    first_post_reset_access_target: firstPostResetAccess,
    flag_all_post_reset_access: {
      true_positives: accessTruePositives,
      false_alarms_on_authorized_survivors: accessFalseAlarms,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditShortcuts(), null, 2)}\n`);
}
