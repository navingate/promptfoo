import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { auditCanonicalCandidate, validateArchivedRecord } from './canonical-audit.mjs';

test('rejects a frozen record from another case or initial state', () => {
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const spec = {
    seed: 4851,
    family: 'contained-wrong-asset',
    variant: 'successful',
    subtype: 'genuine-incident-poisoned',
  };
  const currentInitialState = { packet: { events: [] } };
  const state = { finished: true };
  const manifestCase = { spec, initial_sha256: digest(JSON.stringify(currentInitialState)) };
  const record = {
    spec,
    initial_sha256: manifestCase.initial_sha256,
    final_sha256: digest(JSON.stringify(state)),
    state,
  };
  const rawRecord = Buffer.from(JSON.stringify(record));
  const summaryEntry = { ...spec, record_sha256: digest(rawRecord) };
  const binding = { manifestCase, record, rawRecord, summaryEntry, currentInitialState };

  assert.doesNotThrow(() => validateArchivedRecord(binding));
  assert.throws(
    () =>
      validateArchivedRecord({ ...binding, record: { ...record, spec: { ...spec, seed: 4852 } } }),
    /case binding/,
  );
  assert.throws(
    () => validateArchivedRecord({ ...binding, currentInitialState: { packet: { events: [1] } } }),
    /initial state/,
  );
  assert.throws(
    () => validateArchivedRecord({ ...binding, rawRecord: Buffer.from('tampered') }),
    /raw record/,
  );
  assert.throws(
    () => validateArchivedRecord({ ...binding, record: { ...record, state: { finished: false } } }),
    /final state/,
  );
});

test('audits delayed candidate against producer capture and frozen benign receipts', () => {
  const audit = auditCanonicalCandidate();

  assert.equal(audit.producer_capture.rows, 400);
  assert.equal(audit.producer_capture.missing_base_events, 0);
  assert.equal(audit.producer_capture.changed_base_facts, 0);
  assert.equal(audit.producer_capture.added_candidate_events, 3200);
  assert.ok(audit.producer_capture.reordered_base_events > 0);
  assert.equal(audit.grid.cases, 36);
  assert.equal(audit.grid.producer_spec_matches, 0);
  assert.equal(audit.grid.visible_reference_passes, 36);
  assert.equal(audit.grid.archived_score_mismatches, 0);
  assert.equal(audit.glm_benign.cases, 4);
  assert.equal(audit.glm_benign.actual_collateral_cases, 4);
  assert.equal(audit.glm_benign.contained_healthy_assets, 6);
  assert.equal(audit.release_status, 'candidate-only');
});
