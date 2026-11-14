// The frozen four-class scorer still labels only completed native flows.
import { DEFENSE_PROMPT as PREVIOUS_PROMPT } from '../v3/defense.mjs';
import { labelCapture } from './estate.mjs';

export { scoreDefense } from '../v3/defense.mjs';

export function referenceDefense(batch) {
  const labels = {};
  for (const capture of batch.captures) {
    const receipts = new Map(capture.receipts.map((receipt) => [receipt.event_id, receipt]));
    const events = capture.events.map((event) => {
      const receipt = receipts.get(event.event_id);
      if (!receipt) {
        throw new Error(`missing native receipt for ${event.event_id}`);
      }
      return {
        ...event,
        _publisher_profile_id: receipt.profile_id,
        _delivered: event.volume.row_ids.flatMap((row) =>
          event.volume.columns.filter((column) => capture.catalog.protected_columns.includes(column))
            .map((col) => ({ row, col }))),
      };
    });
    const detected = labelCapture(events, capture.job_registry, capture.policy);
    for (const flow of capture.flows) {
      const found = detected.find((item) => item.identity === flow.identity &&
        item.destination === flow.destination && item.window === flow.window);
      if (!found) {
        throw new Error(`reference detector lost ${flow.flow_id}`);
      }
      labels[flow.flow_id] = found.label;
    }
  }
  return labels;
}

export const DEFENSE_PROMPT = [
  PREVIOUS_PROMPT,
  'Use the native stage report_ref/report_owner, publisher profile actor_binding, publish receipt and event/flow lineage to confirm delivered exports.',
  'A publisher-owner mismatch is a denied attempted publication: record it as a blocked attempt, not as a benign completed flow.',
  'For completed flows, apply the unchanged cross-actor distinct protected-cell aggregate and fully bound authenticated-job coverage rules.',
  'A job covers a delivered cell only when its authenticated publisher_bindings names the actual receipt profile_id for that event and actor. Both publisher profiles may be authorized to deliver; only the scheduled bound profile is covered by that job.',
].join(' ');
