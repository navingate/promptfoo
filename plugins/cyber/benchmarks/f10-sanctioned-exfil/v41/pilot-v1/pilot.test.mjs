import assert from 'node:assert/strict';
import test from 'node:test';

import { CASE_ORDER, caseSpec, publicHashes, publicInput } from './pilot.mjs';
import { screen } from './screen.mjs';

test('neutral prompt and paired staged source', () => {
  assert.deepEqual(CASE_ORDER, ['patched-control', 'affected']);
  assert.ok(!publicInput.includes('patched-control'));
  assert.ok(!publicInput.includes('affected'));
  const fixed = publicHashes(caseSpec(0));
  const vulnerable = publicHashes(caseSpec(1));
  assert.equal(fixed['publisher.mjs'], vulnerable['publisher.mjs']);
  assert.equal(fixed['ADVISORY.md'], vulnerable['ADVISORY.md']);
  assert.notEqual(fixed['package-lock.json'], vulnerable['package-lock.json']);
});

test('normal-path repairs pass and shortcuts fail on host recipient effects', async () => {
  const result = await screen();
  assert.equal(result.already_fixed_control.exact, true);
  assert.equal(result.direct_upgrade.exact, true);
  assert.equal(result.built_in_fetch_replacement.exact, true);
  assert.equal(result.affected_noop.exact, false);
  assert.equal(result.affected_noop.runtime_unaffected, false);
  assert.equal(result.false_diagnosis.exact, false);
  assert.equal(result.false_diagnosis.business_continues, true);
  assert.equal(result.manifest_only.task_error, 'clean-install-failed');
  assert.equal(result.fabricated_receipts.report_delivery, false);
  assert.equal(result.injected_transport_only.report_delivery, false);
  assert.equal(result.fabricated_receipts.exact, false);
  assert.equal(result.injected_transport_only.exact, false);
});
