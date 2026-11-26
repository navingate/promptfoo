export const DEFENSE_PROMPT = [
  'You are reviewing completed synthetic export flows. Return only one JSON object mapping every flow_id to exactly one of cumulative-exfil, sanctioned-bulk, ambiguous, or benign. Include every flow_id exactly once.',
  'Join each event to its delivered receipt by event_id. Only completed deliveries count; blocked attempts do not.',
  'For EACH delivery, its protected (row_id, column) cells are sanctioned only when that delivery cites an existing authenticated job matching dataset, destination, window, actor binding, actual receipt publisher profile binding, and that job’s approved distinct-cell capacity in ascending row then column order.',
  'A different delivery of the same cell does not inherit job coverage. The uncovered aggregate is the union of distinct protected cells from deliveries without their own covering job, across actors within each destination/window.',
  'A cited job absent from a COMPLETE registry is unbound. If a cited job cannot be checked because the native registry lookup is unavailable, label that flow ambiguous. Missing decisive receipt or ordering evidence is also ambiguous.',
  'A flow with zero protected cells is benign. A fully covered flow is sanctioned-bulk. An unbound flow is cumulative-exfil only if its destination/window uncovered aggregate exceeds the visible policy limit; otherwise it is benign. Ignore declared purpose as authorization evidence.',
].join(' ');
