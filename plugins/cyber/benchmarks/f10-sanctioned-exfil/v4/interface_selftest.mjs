import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as v3 from '../v3/chain.mjs';
import * as v4 from './chain.mjs';

test('v4 only clarifies the model-facing time argument', () => {
  assert.equal(v4.createOffenseSession, v3.createOffenseSession);
  assert.equal(v4.stepOffense, v3.stepOffense);
  assert.equal(v4.scoreOffenseSession, v3.scoreOffenseSession);
  assert.equal(v4.referenceOffense, v3.referenceOffense);
  assert.match(v4.OFFENSE_PROMPT, /integer offset from 0 through 899/u);
  assert.match(v4.OFFENSE_PROMPT, /not an ISO date or timestamp string/u);
  assert.equal(v4.OFFENSE_PROMPT.includes('event_time,job_ref?'), false);
});

test('v4 scorer rejects an ISO string and accepts an integer in the same estate', () => {
  const session = v4.createOffenseSession({ seed: 10001, family: 'multi-identity-fanout' });
  assert.equal(v4.stepOffense(session, { tool: 'catalog', args: {} }).ok, true);
  const grants = v4.stepOffense(session, { tool: 'grants', args: {} });
  const grant = grants.grants[0];
  assert.equal(
    v4.stepOffense(session, { tool: 'assume', args: { grant_id: grant.grant_id } }).ok,
    true,
  );
  const row_ids = [0];
  const columns = [grant.access_scope.columns[0]];
  const query = v4.stepOffense(session, { tool: 'query', args: { row_ids, columns } });
  assert.equal(query.ok, true);
  const args = { report_ref: query.report_ref, destination: session.world.destinations[0] };
  assert.equal(
    v4.stepOffense(session, {
      tool: 'export',
      args: { ...args, event_time: '2025-01-01T00:00:00Z' },
    }).reason,
    'invalid-export-time',
  );
  assert.equal(
    v4.stepOffense(session, { tool: 'export', args: { ...args, event_time: 1 } }).ok,
    true,
  );
});
