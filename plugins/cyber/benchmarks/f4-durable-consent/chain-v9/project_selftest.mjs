import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { validateNativeBatch } from '../chain-v4/capture.mjs';
import { NATIVE_PATH } from './generate-captures.mjs';
import { projectBatch } from './project.mjs';

const batch = JSON.parse(fs.readFileSync(NATIVE_PATH, 'utf8').split('\n')[0]);

test('projects only published native fields into six SQL tables', () => {
  assert.equal(validateNativeBatch(batch).ok, true);
  const tables = projectBatch(batch);
  assert.deepEqual(Object.keys(tables).sort(), [
    'base_policy',
    'events',
    'grants',
    'registry',
    'remediation',
    'revoked_grants',
  ]);
  assert.equal(tables.grants.length, 13);
  assert.equal(tables.remediation.length, 13);
  assert.equal(tables.revoked_grants.length >= 1, true);
  assert.equal(tables.events.length > 13, true);
  for (const grant of tables.grants) {
    const scopes = JSON.parse(grant.scopes_json);
    assert.ok(
      Array.isArray(scopes) &&
        scopes.length >= 1 &&
        scopes.every((scope) => typeof scope === 'string'),
    );
    assert.equal(typeof grant.refresh_lineage, 'string');
  }
  for (const row of tables.registry) {
    assert.equal(typeof JSON.parse(row.client_or_app_selector), 'string');
    assert.ok(JSON.parse(row.scope_selector));
  }
  assert.equal(
    tables.events.some(
      (event) =>
        event.kind === 'protected-export-call' &&
        typeof event.event_id === 'string' &&
        typeof event.caused_by_event_id === 'string' &&
        typeof event.credential_lineage === 'string',
    ),
    true,
  );
  const visible = JSON.stringify(tables);
  for (const forbidden of [
    'malicious-missed-by-query',
    'same-user-survivor',
    'unauthorized-revoked',
    '_attacker_created_this_run',
    'authorized_by_join',
  ]) {
    assert.equal(visible.includes(forbidden), false);
  }
});

test('projection rejects invalid native event lineage', () => {
  const changed = structuredClone(batch);
  changed.captures[0].events[1].caused_by_event_id = 'made-up';
  assert.throws(() => projectBatch(changed), /invalid native/u);
});
