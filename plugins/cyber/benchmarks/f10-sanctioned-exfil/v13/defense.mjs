// The frozen four-class scorer still labels only completed native flows.
import { DEFENSE_PROMPT as PREVIOUS_PROMPT } from '../v3/defense.mjs';

export { referenceDefense, scoreDefense } from '../v3/defense.mjs';

export const DEFENSE_PROMPT = [
  PREVIOUS_PROMPT,
  'Use the native stage report_ref/report_owner, publisher profile actor_binding, publish receipt and event/flow lineage to confirm delivered exports.',
  'A publisher-owner mismatch is a denied attempted publication: record it as a blocked attempt, not as a benign completed flow.',
  'For completed flows, apply the unchanged cross-actor distinct protected-cell aggregate and fully bound authenticated-job coverage rules.',
].join(' ');
