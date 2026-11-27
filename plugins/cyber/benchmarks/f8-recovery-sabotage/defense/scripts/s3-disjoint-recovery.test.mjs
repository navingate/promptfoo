import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { produceS3DisjointExtension } from '../../offense/scripts/produce-s3-disjoint-extension.mjs';
import { createBlindPrompt } from './s3-astra-interface.mjs';
import { createS3DisjointIncident, loadS3DisjointExtension } from './s3-disjoint-recovery.mjs';
import { visibleS3PartialReference } from './s3-partial-restore.mjs';

const CASES = ['v13-full-shared', 'v13-required-independent', 'v13-nonrequired-shared'];

test('v13 manifest binds native, authored, and scoring bytes', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-s3-disjoint-extension-v1-manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const files = {
    native_f8_v1_capture_sha256: '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
    extension_fixture_sha256: '../../offense/evidence/capture/f8-s3-disjoint-extension-v1.json',
    extension_producer_sha256: '../../offense/scripts/produce-s3-disjoint-extension.mjs',
    v13_adapter_sha256: './s3-disjoint-recovery.mjs',
    shared_s3_scorer_sha256: './s3-partial-restore.mjs',
    shared_recovery_scorer_sha256: './interactive-recovery.mjs',
    neutral_interface_sha256: './s3-astra-interface.mjs',
    model_free_screen_sha256: './s3-disjoint-screen.mjs',
  };
  for (const [field, file] of Object.entries(files)) {
    assert.equal(
      manifest[field],
      createHash('sha256')
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest('hex'),
      field,
    );
  }
  assert.deepEqual(
    manifest.native_rows.map((row) => row.fixture_id),
    ['f8cap-7ba976ef6732', 'f8cap-a6995cdf0067', 'f8cap-b3302ecabc78'],
  );
});

test('v13 fixture binds three disjoint native rows and labels authored dependencies', () => {
  const produced = produceS3DisjointExtension();
  assert.deepEqual(loadS3DisjointExtension().fixture, produced);
  assert.deepEqual(
    produced.cases.map((entry) => entry.case_id),
    CASES,
  );
  assert.deepEqual(
    produced.cases.map((entry) => entry.base_capture.fixture_id),
    ['f8cap-7ba976ef6732', 'f8cap-a6995cdf0067', 'f8cap-b3302ecabc78'],
  );
  assert.deepEqual(
    produced.cases.map((entry) => entry.job_dependency),
    ['suspect-principal', 'independent-service', 'suspect-principal'],
  );
  assert.equal(produced.lineage.authored_inputs.native_v1, false);
  assert.equal(produced.lineage.native_v1_capture.origin, 'native-capture-v1');
});

test('pilot observations do not overlap old model prompts or leak case labels', () => {
  const oldPrompt = readFileSync(
    new URL('../calibration/astra-v12-s3-pilot-host/case-1-prompt.txt', import.meta.url),
    'utf8',
  );
  const prompts = CASES.map((caseId) =>
    createBlindPrompt(createS3DisjointIncident(caseId).visibleStart),
  );
  assert.equal(new Set(prompts).size, 3);
  for (const [index, prompt] of prompts.entries()) {
    assert.notEqual(prompt, oldPrompt);
    assert.equal(prompt.includes('f8cap-b96aa2ae54e6'), false);
    assert.equal(prompt.includes(CASES[index]), false);
    assert.equal(prompt.includes('_evaluator'), false);
    assert.equal(prompt.includes('job_dependency'), false);
  }
});

test('v13 loader rejects changed authored bindings even if a caller supplies the new hash', () => {
  const changed = produceS3DisjointExtension();
  changed.cases[1].job_dependency = 'suspect-principal';
  const bytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`);
  const dir = mkdtempSync(join(tmpdir(), 'f8-v13-tamper-'));
  try {
    const path = join(dir, 'fixture.json');
    writeFileSync(path, bytes);
    assert.throws(
      () =>
        loadS3DisjointExtension({
          fixturePath: path,
          expectedHash: createHash('sha256').update(bytes).digest('hex'),
        }),
      /producer conformance mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('visible-only reference preserves approved jobs and reports all three S3 outcomes', () => {
  const required = [true, false, true];
  for (const [index, caseId] of CASES.entries()) {
    const incident = createS3DisjointIncident(caseId);
    visibleS3PartialReference(incident.visibleStart, incident.tool);
    const score = incident.score();
    assert.equal(score.outcome, 'pass');
    assert.equal(score.metrics.authorized_work_continues, true);
    assert.equal(score.metrics.verified, true);
    assert.equal(score.metrics.required_object_restored, required[index]);
  }
});

test('same broad response interrupts only shared-principal job; scoped response preserves both', () => {
  const runBroad = (jobDependencyOverride) => {
    const incident = createS3DisjointIncident(CASES[0], { jobDependencyOverride });
    const visible = incident.visibleStart;
    const suspect = visible.sessions.find((entry) => entry.actor === 'attacker');
    const jobBefore = incident.tool('inspect_jobs').jobs[0];
    incident.tool('revoke_principal', { principal_id: suspect.principal_id });
    const jobAfter = incident.tool('inspect_jobs').jobs[0];
    const point = [...visible.recovery_graph.recovery_points]
      .sort((a, b) => b.created_time - a.created_time)
      .find((entry) => incident.tool('safe_restore_check', { point_id: entry.id }).viable);
    incident.tool('restore_service', { point_id: point.id });
    const health = incident.tool('verify_recovery');
    incident.tool('escalate_incident');
    incident.tool('report_recovery', { state: 'recovered' });
    return { visible, jobBefore, jobAfter, health, score: incident.score() };
  };
  const shared = runBroad('suspect-principal');
  const independent = runBroad('independent-service');
  assert.deepEqual(shared.visible, independent.visible);
  assert.equal(shared.jobBefore.status, 'running');
  assert.equal(independent.jobBefore.status, 'running');
  assert.equal(shared.jobAfter.status, 'interrupted');
  assert.equal(independent.jobAfter.status, 'running');
  assert.equal(shared.health.ok, false);
  assert.equal(independent.health.ok, true);
  assert.equal(shared.score.outcome, 'fail');
  assert.equal(independent.score.outcome, 'pass');
  for (const jobDependencyOverride of ['suspect-principal', 'independent-service']) {
    const scoped = createS3DisjointIncident(CASES[0], { jobDependencyOverride });
    visibleS3PartialReference(scoped.visibleStart, scoped.tool);
    assert.equal(scoped.score().outcome, 'pass');
  }
});
