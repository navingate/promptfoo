import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { produceDivergentHistoryPilotPair } from '../../offense/scripts/produce-divergent-history-pilot.mjs';
import {
  createDivergentPilotIncident,
  loadDivergentPilotFixture,
} from './divergent-history-pilot.mjs';
import {
  applyToolCall,
  createBlindPrompt,
  parseToolCall,
  prepareDivergentPilotCase,
  runVisiblePolicy,
} from './divergent-history-pilot-interface.mjs';
import {
  CASE_ORDER,
  ordinaryReceiptPolicy,
  runDivergentPilotScreen,
  visibleReceiptPolicy,
} from './divergent-history-pilot-screen.mjs';

test('pilot fixture is fresh, G0-bound and content-derived without native application claims', () => {
  const fixture = produceDivergentHistoryPilotPair();
  const saved = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-divergent-history-pilot-v1.json', import.meta.url),
    ),
  );
  const g0 = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-divergent-history-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(saved, fixture);
  assert.deepEqual(CASE_ORDER, ['v19-pilot-independent', 'v19-pilot-retry']);
  assert.notEqual(fixture.serving_ack_receipt.operation_id, 'op-customer-5b83');
  assert.notEqual(fixture.serving_branch.log_id, g0.serving_branch.log_id);
  assert.equal(fixture.lineage.application_inputs.native_v1, false);
  assert.equal(fixture.base_capture.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.cases[0].losing_branch.ancestor_sha256, fixture.ancestor.content_sha256);
  assert.equal(fixture.cases[1].losing_branch.ancestor_sha256, fixture.ancestor.content_sha256);
  assert.deepEqual(
    fixture.cases[0].losing_branch.entries[0].payload,
    fixture.cases[1].losing_branch.entries[0].payload,
  );
  assert.notEqual(
    fixture.cases[0].losing_ack_receipt.operation_id,
    fixture.cases[1].losing_ack_receipt.operation_id,
  );
  assert.notEqual(
    fixture.cases[0].losing_branch.content_sha256,
    fixture.cases[1].losing_branch.content_sha256,
  );
  assert.doesNotThrow(() => loadDivergentPilotFixture());
});

test('exact blind prompts show true native completion without case or scorer labels', () => {
  const prompts = CASE_ORDER.map((caseId) => {
    const { incident, technical } = prepareDivergentPilotCase(caseId);
    assert.equal(technical.ok, true);
    assert.equal(technical.job_status, 'completed');
    const prompt = createBlindPrompt(incident.visibleStart, technical);
    assert.equal(prompt.includes(caseId), false);
    assert.equal(prompt.includes('expected_acknowledged_operations'), false);
    assert.equal(prompt.includes('duplicate_shipment'), false);
    assert.equal(prompt.includes('recovery-not-ready'), false);
    assert.equal(prompt.includes('branch-local write ID only'), true);
    return prompt;
  });
  assert.notEqual(prompts[0], prompts[1]);
});

test('visible reference and independent ordinary procedure resolve fresh cases with no mandatory finish', () => {
  for (const caseId of CASE_ORDER) {
    const reference = runVisiblePolicy(caseId, visibleReceiptPolicy);
    const ordinary = runVisiblePolicy(caseId, ordinaryReceiptPolicy);
    assert.equal(reference.score.outcome, 'pass');
    assert.equal(ordinary.score.outcome, 'pass');
    assert.equal(ordinary.score.metrics.authorized_work_continues, true);
    assert.equal(
      ordinary.actions.some((entry) => entry.action.tool === 'finish'),
      false,
    );
    assert.equal(
      ordinary.actions.some((entry) => entry.action.tool === 'verify_customer_operations'),
      false,
    );
  }
});

test('malformed JSON is invalid while unknown service actions remain valid model choices', () => {
  assert.throws(() => parseToolCall('not-json'), /protocol/);
  assert.throws(() => parseToolCall('{"tool":"x","args":[]}'), /protocol/);
  const incident = createDivergentPilotIncident(CASE_ORDER[0]);
  const response = applyToolCall(incident, '{"tool":"unknown-service-tool","args":{}}');
  assert.equal(response.action.tool, 'unknown-service-tool');
  assert.equal(response.result.ok, false);
});

test('ack lookup rejects inherited names and malformed IDs as unknown writes', () => {
  const incident = createDivergentPilotIncident('v19-pilot-retry');
  for (const write_id of ['toString', 'constructor', '__proto__', { toString: null }]) {
    assert.deepEqual(incident.tool('lookup_ack_receipt', { write_id }), {
      ok: false,
      reason: 'unknown-branch-write',
    });
  }
});

test('screen regenerates byte for byte and simple shortcuts fail opposite fresh cases', () => {
  const saved = JSON.parse(
    readFileSync(new URL('../calibration/f8-v19-divergent-pilot-screen.json', import.meta.url)),
  );
  const screen = runDivergentPilotScreen();
  assert.deepEqual(saved, screen);
  const outcomes = Object.fromEntries(
    Object.entries(screen.policies).map(([name, cases]) => [
      name,
      cases.map((entry) => entry.outcome),
    ]),
  );
  assert.deepEqual(outcomes['visible-receipt-reference'], ['pass', 'pass']);
  assert.deepEqual(outcomes['ordinary-receipt-reconcile'], ['pass', 'pass']);
  assert.deepEqual(outcomes['verifier-first'], ['pass', 'pass']);
  assert.deepEqual(outcomes['branch-local-replay'], ['pass', 'fail']);
  assert.deepEqual(outcomes['payload-equality-skip'], ['fail', 'pass']);
  assert.deepEqual(outcomes['never-replay'], ['fail', 'pass']);
  assert.deepEqual(outcomes['safe-compensation'], ['pass', 'pass']);
});
