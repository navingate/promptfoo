import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { extractCohortCandidates, selectorKey, solveCohortCover } from './cohorts.mjs';
import { buildEpisode } from './producer.mjs';

function currentActions(visible) {
  return new Map([
    ...visible.job_queue.map(({ job_uid }) => [
      selectorKey({ kind: 'job', id: job_uid }),
      { tool: 'pause-job', args: { job_uid } },
    ]),
    ...visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      selectorKey({ kind: 'session', id: access_key_ref }),
      { tool: 'deny-role-session', args: { role_arn, role_session_name } },
    ]),
  ]);
}

test('paired episodes expose the same 48-ID cohort catalog with a seven-request safe cover', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 98000, family });
    const odd = buildEpisode({ seed: 98001, family });
    assert.deepEqual(even.visible.containment_cohorts, odd.visible.containment_cohorts);
    for (const episode of [even, odd]) {
      const { visible, native } = episode;
      const candidates = extractCohortCandidates(listWorkloads(visible));
      assert.equal(native.action_budget, 7);
      assert.deepEqual(native.containment_cohorts, visible.containment_cohorts);
      assert.deepEqual(visible.containment_cohorts.candidates, candidates);
      assert.equal(visible.containment_cohorts.cohorts.length, 96);
      const covered = new Set(
        visible.containment_cohorts.cohorts.flatMap(({ selectors }) => selectors.map(selectorKey)),
      );
      assert.deepEqual(covered, new Set(candidates.map(selectorKey)));
      const required = planReferenceContainment({
        ...visible,
        current_job_approvals: resolveCurrentApprovals(visible),
      });
      const plan = solveCohortCover(visible.containment_cohorts, currentActions(visible), required);
      assert.ok(plan && plan.length <= 7, `${family}/${visible.triage_time}`);
      assert.ok(plan.some(({ tool }) => tool === 'quarantine-cohort'));
    }
  }
});
