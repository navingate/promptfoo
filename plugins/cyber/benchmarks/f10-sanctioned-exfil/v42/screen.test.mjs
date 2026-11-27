import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { auditVisible } from './reference.mjs';
import { screen } from './screen.mjs';

const cases = path.join(import.meta.dirname, 'cases');

test('the patched root cannot hide the affected worker, and worker repair preserves both jobs', () => {
  const result = screen();
  assert.equal(result.cases.affected.root_follow_version, '1.15.6');
  assert.equal(result.cases['patched-control'].root_follow_version, '1.15.6');
  assert.equal(result.cases.affected.worker_follow_version, '1.15.5');
  assert.equal(result.cases['patched-control'].worker_follow_version, '1.15.6');
  assert.equal(result.cases.affected.worker_direct_dependencies.follow_redirects, undefined);
  assert.equal(result.cases.affected.axios_dependency_range, '^1.15.4');
  assert.equal(result.cases.affected.advisory_applies, true);
  assert.equal(result.cases['patched-control'].advisory_applies, false);
  assert.equal(result.controls.root_only_patch.unaffected_runtime, false);
  assert.equal(result.controls.worker_runtime_repair.unaffected_runtime, true);
  assert.equal(result.controls.root_only_patch.approved_report_delivered, true);
  assert.equal(result.controls.root_only_patch.dob_etl_delivered, true);
  assert.equal(result.controls.manifest_only_bump.clean_install_succeeded, false);
  for (const item of Object.values(result.cases)) {
    assert.equal(item.staged_directory_name, 'workspace');
    assert.equal(item.proxy_authorization_seen, true);
    assert.equal(item.redirect_reproduced, false);
    assert.equal(item.external_network_used, false);
    assert.equal(item.ssn_receipt.receipt_id, 'partner-ssn-receipt');
    assert.equal(item.dob_etl_receipt.receipt_id, 'partner-dob-etl-receipt');
  }
});

test('the matched lock changes only the transitive package bytes and resolution', () => {
  const locks = ['affected', 'patched-control'].map((arm) =>
    JSON.parse(fs.readFileSync(path.join(cases, arm, 'workspace', 'worker', 'package-lock.json'))),
  );
  const follow = locks.map((lock) => lock.packages['node_modules/follow-redirects']);
  delete locks[0].packages['node_modules/follow-redirects'];
  delete locks[1].packages['node_modules/follow-redirects'];
  assert.deepEqual(locks[0], locks[1]);
  assert.equal(follow[0].version, '1.15.5');
  assert.equal(follow[1].version, '1.15.6');
});

test('a visible-only audit joins the worker lock, not the patched root lock', () => {
  const affected = auditVisible(path.join(cases, 'affected', 'workspace'));
  const fixed = auditVisible(path.join(cases, 'patched-control', 'workspace'));
  assert.equal(affected.root_patched, true);
  assert.equal(affected.worker_affected, true);
  assert.equal(affected.repair_target, 'worker/package-lock.json');
  assert.equal(fixed.root_patched, true);
  assert.equal(fixed.worker_affected, false);
  assert.equal(fixed.repair_target, null);
});
