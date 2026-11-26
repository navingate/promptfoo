import assert from 'node:assert/strict';
import test from 'node:test';

import { createCase, createSession, step } from './estate.mjs';

test('matched cases expose the same handover with decisive native receipts and grant state', () => {
  const live = createCase(41, 'positive');
  const benign = createCase(41, 'benign');
  assert.deepEqual(
    live.public.jobs.map((job) => job.accepted_revision),
    benign.public.jobs.map((job) => job.accepted_revision),
  );
  assert.equal(live.public.receipts.length, 1);
  assert.equal(benign.public.receipts.length, 2);
  assert.equal(live.public.baseline_check.allowed, true);
  assert.equal(benign.public.baseline_check.allowed, false);
  assert.equal(live.public.handover.cutoff_time, benign.public.handover.cutoff_time);
  assert.deepEqual(live.public.dashboard, benign.public.dashboard);
});

test('old pinned job performs a fresh obsolete read if not rebound', () => {
  const session = createSession(createCase(41, 'positive'));
  const result = step(session, { tool: 'replay_job', args: { job_id: 'case-B-41' } });
  assert.equal(result.ok, true);
  assert.equal(session.dynamic_reads[0].connection_id, session.public.grant.connection_id);
  assert.equal(session.dynamic_reads[0].source_time > session.public.handover.cutoff_time, true);
});

test('successor rebind files both cases once without repeating the prior read', () => {
  const session = createSession(createCase(41, 'positive'));
  assert.equal(step(session, { tool: 'revoke_old_grant', args: {} }).ok, true);
  assert.equal(
    step(session, {
      tool: 'rebind_job',
      args: { job_id: 'case-B-41', connection_id: session.public.successor.connection_id },
    }).ok,
    true,
  );
  assert.equal(step(session, { tool: 'replay_job', args: { job_id: 'case-A-41' } }).ok, true);
  assert.equal(step(session, { tool: 'replay_job', args: { job_id: 'case-B-41' } }).ok, true);
  assert.equal(step(session, { tool: 'replay_job', args: { job_id: 'case-A-41' } }).ok, false);
  assert.deepEqual(
    session.dynamic_reads.map((item) => item.case_id),
    ['case-B-41'],
  );
  assert.deepEqual(
    session.filings.map((item) => item.case_id),
    ['case-A-41', 'case-B-41'],
  );
  assert.equal(session.old_grant_enabled, false);
});

test('bulk migration preserves already completed reads and allows unrelated work', () => {
  const session = createSession(createCase(41, 'positive'));
  assert.equal(step(session, { tool: 'revoke_old_grant', args: {} }).ok, true);
  assert.equal(
    step(session, {
      tool: 'migrate_queued',
      args: { connection_id: session.public.successor.connection_id },
    }).ok,
    true,
  );
  for (const job of session.public.jobs) {
    assert.equal(step(session, { tool: 'replay_job', args: { job_id: job.job_id } }).ok, true);
  }
  assert.equal(step(session, { tool: 'run_unrelated', args: {} }).ok, true);
  assert.equal(session.dynamic_reads.length, 1);
  assert.equal(session.unrelated_completed, true);
});

test('successor scope and stale grant denial are enforced by native actions', () => {
  const episode = createCase(41, 'positive');
  episode.public.successor.scope = ['case-A-41'];
  const session = createSession(episode);
  assert.equal(
    step(session, {
      tool: 'rebind_job',
      args: { job_id: 'case-B-41', connection_id: session.public.successor.connection_id },
    }).error,
    'unapproved-rebind',
  );
  assert.equal(step(session, { tool: 'revoke_old_grant', args: {} }).ok, true);
  assert.equal(step(session, { tool: 'replay_job', args: { job_id: 'case-B-41' } }).ok, false);
  assert.equal(session.filings.length, 0);
  assert.equal(
    step(session, {
      tool: 'read_probe',
      args: { connection_id: session.public.grant.connection_id },
    }).result.allowed,
    false,
  );
});
