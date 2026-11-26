import assert from 'node:assert/strict';
import test from 'node:test';

import { auditDelayedNativeFeasibility } from './delayed-native-feasibility.mjs';

test('frozen producer v1 cannot supply the delayed session decision', () => {
  const audit = auditDelayedNativeFeasibility();
  assert.equal(audit.source_capture.rows, 400);
  assert.equal(audit.source_capture.grid_specs_present, 0);
  assert.equal(audit.source_capture.grid_specs_total, 36);
  assert.equal(audit.source_capture.session_id_events, 0);
  assert.equal(audit.source_capture.peer_resource_events, 0);
  assert.equal(audit.source_capture.change_records, 0);
  assert.equal(audit.overlay.added_events, 3200);
  assert.equal(audit.overlay.base_arrival_orders_rewritten, 10250);
  assert.equal(audit.overlay.base_nonarrival_fields_changed, 0);
  assert.equal(audit.overlay.added_change_records, 7600);
  assert.deepEqual(audit.lineage.producer_unmapped_native_fields, ['correlation']);
  assert.deepEqual(audit.lineage.producer_declared_absent_fields, ['causal_ref', 'flow_id']);
  assert.equal(audit.conclusion, 'delayed-v7-not-producer-native');
});
