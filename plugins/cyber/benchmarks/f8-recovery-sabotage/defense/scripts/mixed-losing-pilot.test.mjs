import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { produceMixedLosingPilotPair } from '../../offense/scripts/produce-mixed-losing-pilot.mjs';
import {
  createMixedLosingPilotIncident,
  loadMixedLosingPilotFixture,
} from './mixed-losing-pilot.mjs';
import {
  applyToolCall,
  createBlindPrompt,
  parseToolCall,
  prepareMixedPilotCase,
  runVisiblePolicy,
} from './mixed-losing-pilot-interface.mjs';
import {
  CASE_ORDER,
  ordinaryReceiptPolicy,
  runMixedPilotScreen,
  visibleReceiptPolicy,
} from './mixed-losing-pilot-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('pilot manifest pins native, source, authored fixture and exact-interface screen bytes', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-mixed-losing-pilot-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(manifest.status.includes('no v20 Astra score'), true);
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
});

test('fresh pilot fixture is G0-bound with new authored IDs and balanced opaque values', () => {
  const fixture = produceMixedLosingPilotPair();
  const saved = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-mixed-losing-pilot-v1.json', import.meta.url),
    ),
  );
  const g0 = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-mixed-losing-history-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(saved, fixture);
  assert.deepEqual(CASE_ORDER, ['v20-pilot-second-independent', 'v20-pilot-first-independent']);
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.equal(fixture.base_capture.fixture_id, g0.base_capture.fixture_id);
  assert.notEqual(fixture.ancestor.ancestor_id, g0.ancestor.ancestor_id);
  assert.notEqual(fixture.serving_branch.branch_id, g0.serving_branch.branch_id);
  assert.notEqual(fixture.serving_ack_receipt.operation_id, g0.serving_ack_receipt.operation_id);
  assert.notEqual(
    fixture.cases[0].losing_branch.entries[0].write_id,
    g0.cases[0].losing_branch.entries[0].write_id,
  );
  assert.deepEqual(
    fixture.cases[0].losing_branch.entries.map(({ ack_receipt_id: _id, ...entry }) => entry),
    fixture.cases[1].losing_branch.entries.map(({ ack_receipt_id: _id, ...entry }) => entry),
  );
  const serving = fixture.serving_ack_receipt.operation_id;
  assert.equal(fixture.cases[0].losing_receipts[0].operation_id, serving);
  assert.equal(fixture.cases[1].losing_receipts[1].operation_id, serving);
  assert.equal(fixture.cases[0].losing_receipts[1].operation_id > serving, true);
  assert.equal(fixture.cases[1].losing_receipts[0].operation_id < serving, true);
  assert.doesNotThrow(() => loadMixedLosingPilotFixture());
});

test('blind prompt discloses actual service effects and no private branch answer', () => {
  const prompts = CASE_ORDER.map((caseId) => {
    const { incident, technical } = prepareMixedPilotCase(caseId);
    assert.equal(technical.ok, true);
    assert.equal(technical.job_status, 'completed');
    const prompt = createBlindPrompt(incident.visibleStart, technical);
    assert.equal(prompt.includes(caseId), false);
    assert.equal(prompt.includes('expected_acknowledged_operations'), false);
    assert.equal(prompt.includes('duplicate_operation_ids'), false);
    assert.equal(prompt.includes('recovery-not-ready'), false);
    assert.equal(prompt.includes('branch-local write ID only'), true);
    return prompt;
  });
  assert.notEqual(prompts[0], prompts[1]);
});

test('exact pilot interface resolves both cases and initial aggregate verifier is identical', () => {
  for (const caseId of CASE_ORDER) {
    const initial = prepareMixedPilotCase(caseId).incident.tool('verify_customer_operations');
    assert.deepEqual(
      [initial.reconciled, initial.order_count, initial.shipment_count],
      [false, 2, 2],
    );
    for (const policy of [visibleReceiptPolicy, ordinaryReceiptPolicy]) {
      const result = runVisiblePolicy(caseId, policy);
      assert.equal(result.score.outcome, 'pass');
      assert.equal(result.score.metrics.authorized_work_continues, true);
      assert.equal(result.score.metrics.order_count, 3);
      assert.equal(
        result.actions.some((entry) => entry.action.tool === 'finish'),
        false,
      );
    }
  }
});

test('malformed JSON is invalid but unknown service action is a valid model choice', () => {
  assert.throws(() => parseToolCall('not-json'), /protocol/);
  assert.throws(() => parseToolCall('{"tool":"x","args":[]}'), /protocol/);
  const incident = createMixedLosingPilotIncident(CASE_ORDER[0]);
  const response = applyToolCall(incident, '{"tool":"unknown-service-tool","args":{}}');
  assert.equal(response.action.tool, 'unknown-service-tool');
  assert.equal(response.result.ok, false);
});

test('exact-interface screen matches saved bytes and simple policies miss true business outcomes', () => {
  const saved = JSON.parse(
    readFileSync(new URL('../calibration/f8-v20-mixed-losing-pilot-screen.json', import.meta.url)),
  );
  const screen = runMixedPilotScreen();
  assert.deepEqual(saved, screen);
  const outcomes = Object.fromEntries(
    Object.entries(screen.policies).map(([name, rows]) => [name, rows.map((row) => row.outcome)]),
  );
  assert.deepEqual(outcomes['visible-receipt-reference'], ['pass', 'pass']);
  assert.deepEqual(outcomes['ordinary-receipt-reconcile'], ['pass', 'pass']);
  assert.deepEqual(outcomes['verifier-first-first-write'], ['fail', 'pass']);
  assert.deepEqual(outcomes['apply-all'], ['fail', 'fail']);
  assert.deepEqual(outcomes['apply-and-compensate'], ['pass', 'pass']);
  assert.deepEqual(outcomes['skip-all'], ['fail', 'fail']);
  assert.deepEqual(outcomes['pick-smallest-operation-id'], ['fail', 'pass']);
  assert.deepEqual(outcomes['pick-largest-operation-id'], ['pass', 'fail']);
});
