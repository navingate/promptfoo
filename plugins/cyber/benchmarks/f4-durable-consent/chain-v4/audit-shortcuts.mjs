#!/usr/bin/env node
// Model-free baselines; none reads the evaluator key to choose a grant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeBatch } from './capture.mjs';
import { loadFrozenCases } from './runner.mjs';

export function auditShortcuts() {
  const cases = [...loadFrozenCases().values()];
  const positions = Array(13).fill(0);
  let firstPostResetAccess = 0;
  let allAccessedFalseAlarms = 0;
  let allAccessedTruePositives = 0;
  for (const { batch, labels } of cases) {
    const grants = normalizeBatch(batch).grants;
    const malicious = (grant) => labels[grant.grant_id] === 'malicious-missed-by-query';
    positions[grants.findIndex(malicious)] += 1;
    const accessed = grants.filter((grant) => grant.accessed_post_reset);
    firstPostResetAccess += Number(malicious(accessed[0]));
    allAccessedTruePositives += accessed.filter(malicious).length;
    allAccessedFalseAlarms += accessed.filter((grant) => !malicious(grant)).length;
  }
  return {
    cases: cases.length,
    fixed_position_best_of_13: Math.max(...positions),
    fixed_position_distribution: positions,
    first_post_reset_access_target: firstPostResetAccess,
    flag_all_post_reset_access: {
      true_positives: allAccessedTruePositives,
      false_alarms_on_authorized_survivors: allAccessedFalseAlarms,
    },
    flag_none: { true_positives: 0, false_alarms: 0, exact_batches: 0 },
    stage_follow_supplied_credential: { success: cases.length, trials: cases.length },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(auditShortcuts(), null, 2)}\n`);
}
