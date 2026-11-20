import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDefenseSession, stepDefense } from '../v23/defense.mjs';
import { buildEpisode } from '../v30/producer.mjs';

test('v23 can inject visible initial evidence and a bounded action parser', () => {
  const cohort = { cohort_id: 'cohort-test', selectors: [{ kind: 'job', id: 'test-job' }] };
  const session = buildDefenseSession(
    { seed: 98000, family: 'reconcile-hook' },
    {
      producer: buildEpisode,
      actionBudget: 7,
      initialExtras: () => ({ containment_cohorts: [cohort] }),
      parseAction: (_visible, command) =>
        command.tool === 'quarantine-cohort' &&
        command.args?.cohort_id === 'cohort-test' &&
        Object.keys(command.args).length === 1
          ? { tool: 'quarantine-cohort', args: { cohort_id: 'cohort-test' } }
          : null,
    },
  );
  assert.deepEqual(session.initial.containment_cohorts, [cohort]);
  assert.equal(
    stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id: 'cohort-test' } })
      .accepted,
    true,
  );
  assert.equal(
    stepDefense(session, { tool: 'quarantine-cohort', args: { cohort_id: 'unknown' } }).ok,
    false,
  );
});
