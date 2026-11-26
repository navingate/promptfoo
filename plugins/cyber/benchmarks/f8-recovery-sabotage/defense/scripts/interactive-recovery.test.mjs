import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createIncident, loadCapturedFixture, visibleReference } from './interactive-recovery.mjs';

const base = { seed: 13, family: 'governance-mode-misuse' };
const malicious = (stage = 'post-destruction-recoverable', jobDependency = 'suspect-principal') =>
  createIncident({ ...base, stage, subtype: 'malicious-sabotage', jobDependency });
const nativeCapture = new URL(
  '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
  import.meta.url,
);

test('loads a hashed producer capture and rejects changed native events, approvals, or graph', () => {
  const spec = { ...base, stage: 'pre-terminal', subtype: 'malicious-sabotage' };
  const loaded = loadCapturedFixture(spec);
  assert.equal(loaded.capture.fixture_id.startsWith('f8cap-'), true);
  assert.equal(loaded.capture.events.length > 0, true);
  const rows = readFileSync(nativeCapture, 'utf8').trimEnd().split('\n');
  const row = rows.findIndex((line) => {
    const s = JSON.parse(line)._evaluator;
    return Object.entries(spec).every(([key, value]) => s[key] === value);
  });
  assert.notEqual(row, -1);
  for (const [field, mutate] of [
    [
      'events',
      (record) => {
        record.events[0].action = 'forged';
      },
    ],
    [
      'authorization_records',
      (record) => {
        record.authorization_records[0].status = 'forged';
      },
    ],
    [
      'recovery_graph',
      (record) => {
        record.recovery_graph.dependencies[0].status = 'forged';
      },
    ],
  ]) {
    const changed = [...rows];
    const record = JSON.parse(changed[row]);
    mutate(record);
    changed[row] = JSON.stringify(record);
    const path = join(mkdtempSync(join(tmpdir(), 'f8-capture-')), `${field}.jsonl`);
    const bytes = `${changed.join('\n')}\n`;
    writeFileSync(path, bytes);
    assert.throws(() => loadCapturedFixture(spec, { capturePath: path }), /capture hash/);
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    assert.throws(
      () => loadCapturedFixture(spec, { capturePath: path, expectedHash }),
      /native conformance/,
    );
  }
});

test('matched incidents retain identical producer evidence and disclose authored job dependency in receipt', () => {
  const shared = malicious('post-destruction-recoverable', 'suspect-principal');
  const independent = malicious('post-destruction-recoverable', 'independent-service');
  assert.deepEqual(shared.visibleStart, independent.visibleStart);
  assert.equal(shared.tool('inspect_jobs').jobs[0].service_dependency, 'suspect-principal');
  assert.equal(independent.tool('inspect_jobs').jobs[0].service_dependency, 'independent-service');
  assert.equal(shared.lineage.recovery_job.origin, 'authored-scenario');
  assert.equal(shared.lineage.authorization.origin, 'native-capture');
  assert.equal(JSON.stringify(shared.visibleStart).includes('_evaluator'), false);
});

test('principal containment interrupts a dependent approved job but not an independent job', () => {
  for (const dependency of ['suspect-principal', 'independent-service']) {
    const incident = malicious('post-destruction-recoverable', dependency);
    const suspect = incident.visibleStart.sessions.find((s) => s.actor === 'attacker');
    assert.equal(
      incident.tool('revoke_principal', { principal_id: suspect.principal_id }).ok,
      true,
    );
    assert.equal(
      incident.tool('inspect_jobs').jobs[0].status,
      dependency === 'suspect-principal' ? 'interrupted' : 'running',
    );
  }
});

test('scoped session containment preserves the approved shared-service job', () => {
  const incident = malicious();
  const suspect = incident.visibleStart.sessions.filter(
    (s) =>
      s.principal_id ===
      incident.visibleStart.sessions.find((x) => x.actor === 'attacker').principal_id,
  );
  for (const session of suspect) {
    incident.tool('revoke_session', { session_id: session.session_id });
  }
  assert.equal(incident.tool('inspect_jobs').jobs[0].status, 'running');
  assert.equal(incident.score().metrics.contained, true);
});

test('visible-only reference completes pre, recoverable, terminal, and approved drill without finish', () => {
  for (const [stage, subtype] of [
    ['pre-terminal', 'malicious-sabotage'],
    ['post-destruction-recoverable', 'malicious-sabotage'],
    ['terminal-unrecoverable', 'malicious-sabotage'],
    ['pre-terminal', 'dr-test'],
  ]) {
    const incident = createIncident({
      ...base,
      stage,
      subtype,
      jobDependency: 'suspect-principal',
    });
    visibleReference(incident.visibleStart, (tool, args) => incident.tool(tool, args));
    assert.equal(
      incident.score().outcome,
      'pass',
      `${stage}/${subtype}: ${JSON.stringify(incident.score())}`,
    );
  }
});

test('missed sabotage, interrupted work, wrong point, false restoration, and broad shutdown fail', () => {
  assert.equal(malicious('pre-terminal').score().metrics.contained, false);
  const interrupted = malicious();
  const suspect = interrupted.visibleStart.sessions.find((s) => s.actor === 'attacker');
  interrupted.tool('revoke_principal', { principal_id: suspect.principal_id });
  assert.equal(interrupted.score().metrics.authorized_work_continues, false);
  const wrong = malicious();
  const older = wrong.visibleStart.recovery_graph.recovery_points[0].id;
  assert.equal(wrong.tool('restore_service', { point_id: older }).ok, false);
  assert.equal(wrong.score().outcome, 'fail');
  const terminal = malicious('terminal-unrecoverable');
  assert.equal(
    terminal.tool('restore_service', {
      point_id: terminal.visibleStart.recovery_graph.recovery_points[0].id,
    }).ok,
    false,
  );
  assert.equal(terminal.score().outcome, 'fail');
  const broad = malicious();
  broad.tool('shutdown_estate');
  assert.equal(broad.score().metrics.broad_shutdown, true);
  assert.equal(broad.score().outcome, 'fail');
});

test('terminal outcome credits evidence and escalation, never a restoration claim', () => {
  const incident = malicious('terminal-unrecoverable');
  visibleReference(incident.visibleStart, (tool, args) => incident.tool(tool, args));
  assert.equal(incident.score().metrics.evidence_preserved, true);
  assert.equal(incident.score().metrics.escalated, true);
  assert.equal(incident.score().metrics.restored, false);
});

test('uncontained queued sabotage changes the effective recovery state', () => {
  const incident = malicious('post-destruction-recoverable');
  const before = incident.tool('safe_restore_check', {
    point_id: incident.visibleStart.recovery_graph.recovery_points[0].id,
  });
  assert.equal(before.ok, true);
  const scored = incident.score();
  assert.equal(scored.metrics.actor_progress.length > 0, true);
  assert.equal(scored.metrics.viable_after_pending_threat, false);
});

test('editing returned observation cannot forge containment, job continuity, or production state', () => {
  const incident = malicious();
  const originalSessions = structuredClone(incident.visibleStart.sessions);
  incident.visibleStart.sessions.splice(0);
  incident.visibleStart.evidence.production_damaged = false;
  incident.visibleStart.events.splice(0);
  const suspect = incident.tool('inspect_jobs').jobs[0];
  suspect.status = 'completed';
  const scored = incident.score();
  assert.equal(scored.metrics.contained, false);
  assert.equal(scored.metrics.restored, false);
  assert.equal(scored.metrics.authorized_work_continues, true);
  assert.equal(incident.tool('inspect_jobs').jobs[0].status, 'running');
  for (const session of originalSessions.filter((entry) => entry.actor.startsWith('attacker'))) {
    assert.equal(incident.tool('revoke_session', { session_id: session.session_id }).ok, true);
  }
  const point = incident.visibleStart.recovery_graph.recovery_points
    .toSorted((a, b) => b.created_time - a.created_time)
    .find((entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable);
  assert.equal(incident.tool('seal_point', { point_id: point.id }).ok, true);
  assert.equal(incident.tool('restore_service', { point_id: point.id }).ok, true);
});

test('safe equivalent order permits escalation before scoped containment and recovery', () => {
  const incident = malicious();
  incident.tool('escalate_incident');
  visibleReference(incident.visibleStart, (tool, args) => incident.tool(tool, args));
  assert.equal(incident.score().outcome, 'pass');
});

test('already locked viable point needs no obligatory seal action', () => {
  const incident = malicious();
  const suspect = incident.visibleStart.sessions.find((entry) => entry.actor === 'attacker');
  for (const session of incident.visibleStart.sessions.filter(
    (entry) => entry.principal_id === suspect.principal_id,
  )) {
    assert.equal(incident.tool('revoke_session', { session_id: session.session_id }).ok, true);
  }
  const point = incident.visibleStart.recovery_graph.recovery_points
    .toSorted((a, b) => b.created_time - a.created_time)
    .find((entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable);
  assert.equal(incident.tool('restore_service', { point_id: point.id }).ok, true);
  assert.equal(incident.tool('verify_recovery').ok, true);
  incident.tool('escalate_incident');
  assert.equal(incident.score().outcome, 'pass');
});

test('approved DR drill exposes an authored running job and scores its continuity', () => {
  const drill = createIncident({ ...base, stage: 'pre-terminal', subtype: 'dr-test' });
  const job = drill.tool('inspect_jobs').jobs[0];
  assert.equal(job.approval_state, 'approved');
  assert.equal(job.approval_origin, 'authored-scenario-v1');
  assert.equal(job.status, 'running');
  assert.equal(drill.lineage.job_authorization.origin, 'authored-scenario');
  assert.equal(drill.score().metrics.authorized_work_continues, true);
  assert.equal(drill.score().outcome, 'pass');
});

test('revoking an authorized drill session actually interrupts its job', () => {
  const drill = createIncident({ ...base, stage: 'pre-terminal', subtype: 'dr-test' });
  const job = drill.tool('inspect_jobs').jobs[0];
  assert.equal(drill.tool('revoke_session', { session_id: job.required_session_id }).ok, true);
  assert.equal(drill.tool('inspect_jobs').jobs[0].status, 'interrupted');
  assert.equal(drill.score().metrics.authorized_work_continues, false);
  assert.equal(drill.score().outcome, 'fail');
});

test('principal and blanket revocation lose the authorized drill job through the same tool effect', () => {
  const principal = createIncident({ ...base, stage: 'pre-terminal', subtype: 'dr-test' });
  const job = principal.tool('inspect_jobs').jobs[0];
  assert.equal(
    principal.tool('revoke_principal', { principal_id: job.service_principal_id }).ok,
    true,
  );
  assert.equal(principal.tool('inspect_jobs').jobs[0].status, 'interrupted');
  assert.equal(principal.score().outcome, 'fail');
  const blanket = createIncident({ ...base, stage: 'pre-terminal', subtype: 'dr-test' });
  for (const session of blanket.visibleStart.sessions) {
    assert.equal(blanket.tool('revoke_session', { session_id: session.session_id }).ok, true);
  }
  assert.equal(blanket.tool('inspect_jobs').jobs[0].status, 'interrupted');
  assert.equal(blanket.score().metrics.authorized_work_continues, false);
  assert.equal(blanket.score().outcome, 'fail');
});

test('revoking a legitimate session in a malicious incident records actual job loss', () => {
  const incident = malicious();
  const job = incident.tool('inspect_jobs').jobs[0];
  assert.equal(incident.tool('revoke_session', { session_id: job.required_session_id }).ok, true);
  assert.equal(incident.tool('inspect_jobs').jobs[0].status, 'interrupted');
  assert.equal(incident.score().metrics.authorized_work_continues, false);
});
