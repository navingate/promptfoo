import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyToolCall,
  createBlindPrompt,
  MAX_ACTIONS,
  parseToolCall,
  runVisiblePolicy,
} from './cross-store-pilot-interface.mjs';
import { createCrossStorePilotIncident } from './cross-store-pilot-recovery.mjs';
import { visibleReference as nativeReference } from './interactive-recovery.mjs';

test('blind prompts match across twins and disclose real principal, technical, and replay effects', () => {
  const applied = createBlindPrompt(
    createCrossStorePilotIncident('v16-pilot-applied').visibleStart,
  );
  const pending = createBlindPrompt(
    createCrossStorePilotIncident('v16-pilot-pending').visibleStart,
  );
  assert.equal(applied, pending);
  assert.equal(applied.includes('v16-pilot-applied'), false);
  assert.equal(applied.includes('v16-pilot-pending'), false);
  assert.equal(applied.includes('expected_outcome'), false);
  assert.match(applied, /revoke_principal.*interrupts approved jobs depending on that principal/s);
  assert.match(applied, /verify_recovery.*technical service health only/s);
  assert.match(applied, /replay_projection_raw.*not idempotent/s);
  assert.match(applied, /replay_projection_once.*idempotent/s);
  assert.equal(MAX_ACTIONS, 32);
});

test('JSON protocol rejects malformed output but treats an unknown tool as a valid model action', () => {
  assert.throws(() => parseToolCall('some prose'), /protocol: response is not JSON/);
  assert.throws(() => parseToolCall('{"tool":"read_order"}'), /protocol: expected/);
  const incident = createCrossStorePilotIncident('v16-pilot-applied');
  const result = applyToolCall(incident, '{"tool":"nonsense","args":{}}');
  assert.equal(result.action.tool, 'nonsense');
  assert.deepEqual(result.result, { ok: false, reason: 'unknown-tool' });
});

test('exact serialized tool interface replays a visible-only reference in both fresh cases', () => {
  for (const caseId of ['v16-pilot-applied', 'v16-pilot-pending']) {
    const incident = createCrossStorePilotIncident(caseId);
    const result = runVisiblePolicy(incident, (visible, call) => {
      nativeReference(visible, call);
      const points = call('inspect_application_checkpoints').checkpoints;
      call('restore_application_stores', {
        orders_checkpoint_id: points.orders.latest.checkpoint_id,
        entitlements_checkpoint_id: points.entitlements.latest.checkpoint_id,
      });
      const receipts = call('inspect_application_receipts');
      const journal = receipts.authorized_journal.find((entry) => entry.kind === 'order-commit');
      const projection = call('read_projection', { event_id: journal.event_id });
      if (projection.count === 0) {
        call('replay_projection_once', { event_id: journal.event_id });
      }
      call('verify_joint_application', { order_id: journal.order_id });
      call('report_joint_recovery', { status: 'complete' });
    });
    assert.equal(result.score.outcome, 'pass');
    assert.equal(result.score.metrics.authorized_work_continues, true);
    assert.equal(result.actions.length < MAX_ACTIONS, true);
  }
});
