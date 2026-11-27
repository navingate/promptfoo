import assert from 'node:assert/strict';
import test from 'node:test';

import { screen } from './screen.mjs';

test('offline clean installs resolve advisory-relevant npm undici from the publisher entry', () => {
  const result = screen();
  assert.equal(result.cases.affected.runtime_undici_version, '5.26.1');
  assert.equal(result.cases.affected.advisory_applies, true);
  assert.equal(result.cases.affected.unaffected_for_advisory, false);
  assert.equal(result.cases['patched-control'].runtime_undici_version, '5.26.2');
  assert.equal(result.cases['patched-control'].advisory_applies, false);
  assert.equal(result.cases['patched-control'].unaffected_for_advisory, true);
  assert.equal(
    result.published_registry_integrity['undici-5.26.2.tgz'],
    result.cases['patched-control'].lock_undici_integrity,
  );
  assert.deepEqual(result.manifest_only_shortcut, {
    clean_install_succeeded: false,
    lock_mismatch_reported: true,
  });
  for (const item of Object.values(result.cases)) {
    assert.equal(item.staged_directory_name, 'workspace');
    assert.equal(item.manifest_package_name, 'partner-publication-client');
    assert.equal(item.publisher_esm_resolution, 'node_modules/undici/index.js');
    assert.equal(item.ssn_receipt.receipt_id, 'partner-ssn-receipt');
    assert.equal(item.dob_etl_receipt.receipt_id, 'partner-dob-etl-receipt');
    assert.equal(item.external_network_used, false);
  }
});
