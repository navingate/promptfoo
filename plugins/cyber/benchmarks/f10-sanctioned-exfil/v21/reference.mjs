// Visible-only report reference. The native producer and its scorer are not imported.
import assert from 'node:assert/strict';

import { auditCapture } from '../v18/reference.mjs';

export function auditIncident(capture) {
  const { labels, audit } = auditCapture(capture);
  assert.equal(new Set(capture.flows.map((flow) => flow.destination)).size, 1);
  assert.equal(new Set(capture.flows.map((flow) => flow.window)).size, 1);
  assert.ok(Object.values(labels).every((label) => label !== 'ambiguous'));

  const events = new Map(capture.events.map((event) => [event.event_id, event]));
  const flowByKey = new Map(
    capture.flows.map((flow) => [
      JSON.stringify([flow.identity, flow.destination, flow.window]),
      flow.flow_id,
    ]),
  );
  const uncovered = new Set();
  const affectedFlows = new Set();
  const authorizedJobs = new Set();
  for (const cell of audit) {
    const event = events.get(cell.event_id);
    assert.ok(event);
    if (cell.authorized) {
      assert.ok(cell.job_ref);
      authorizedJobs.add(cell.job_ref);
    } else {
      uncovered.add(cell.cell);
      const window = Math.floor(cell.completed_at / capture.policy.window_size);
      const flowId = flowByKey.get(
        JSON.stringify([event.actor.identity, event.destination, window]),
      );
      assert.ok(flowId);
      affectedFlows.add(flowId);
    }
  }
  assert.ok(uncovered.size > 0);
  return {
    recipient: capture.flows[0].destination,
    window: capture.flows[0].window,
    record_unauthorized_delivery: true,
    affected_flow_ids: [...affectedFlows].sort(),
    unapproved_distinct_protected_cells: uncovered.size,
    report_tier:
      uncovered.size > capture.policy.cumulative_aggregate_limit
        ? 'cumulative-escalation'
        : 'limited-incident',
    preserve_authorized_job_ids: [...authorizedJobs].sort(),
  };
}
