// Independently reconstruct authorization from model-visible native facts.
// This module deliberately does not import the evaluator's authorization code.
const keyOf = (row, column) => JSON.stringify([row, column]);
const groupOf = (destination, window) => JSON.stringify([destination, window]);
const flowOf = (identity, destination, window) => JSON.stringify([identity, destination, window]);

export function detect(capture) {
  const jobs = new Map(capture.job_registry.map((job) => [job.job_id, job]));
  const receipts = new Map(capture.receipts.map((receipt) => [receipt.event_id, receipt]));
  const protectedColumns = new Set(capture.catalog.protected_columns);
  const groups = new Map();
  for (const event of capture.events) {
    const window = Math.floor(event.event_time / capture.policy.window_size);
    const groupKey = groupOf(event.destination, window);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    const cells = new Map();
    for (const row of event.volume.row_ids) {
      for (const column of event.volume.columns) {
        if (protectedColumns.has(column)) {
          cells.set(keyOf(row, column), { row, column });
        }
      }
    }
    groups.get(groupKey).push({ event, window, cells, receipt: receipts.get(event.event_id) });
  }
  const flowStates = new Map();
  for (const deliveries of groups.values()) {
    const eligibleByJob = new Map();
    const matchingJob = ({ event, window, receipt }) => {
      const job = jobs.get(event.job_ref);
      return job &&
        event.resource?.dataset === job.dataset &&
        event.destination === job.destination &&
        window === job.window &&
        job.actor_binding?.includes(event.actor.identity) &&
        job.publisher_bindings?.some(
          (binding) =>
            binding.actor === event.actor.identity && binding.profile_id === receipt?.profile_id,
        )
        ? job
        : null;
    };
    for (const delivery of deliveries) {
      const job = matchingJob(delivery);
      if (!job) {
        continue;
      }
      if (!eligibleByJob.has(job.job_id)) {
        eligibleByJob.set(job.job_id, new Map());
      }
      for (const [key, cell] of delivery.cells) {
        eligibleByJob.get(job.job_id).set(key, cell);
      }
    }
    const allowances = new Map();
    for (const [jobId, cells] of eligibleByJob) {
      const ordered = [...cells.values()].sort(
        (a, b) => a.row - b.row || a.column.localeCompare(b.column),
      );
      allowances.set(
        jobId,
        new Set(
          ordered
            .slice(0, jobs.get(jobId).approved_cell_volume)
            .map((cell) => keyOf(cell.row, cell.column)),
        ),
      );
    }
    const uncoveredGroup = new Set();
    for (const delivery of deliveries) {
      const { event, window, cells, receipt } = delivery;
      const flowKey = flowOf(event.actor.identity, event.destination, window);
      if (!flowStates.has(flowKey)) {
        flowStates.set(flowKey, {
          protected: new Set(),
          uncovered: new Set(),
          ambiguous: false,
          group: groupOf(event.destination, window),
        });
      }
      const flow = flowStates.get(flowKey);
      const job = matchingJob(delivery);
      if (
        !Number.isFinite(event.event_time) ||
        !Number.isFinite(event.arrival_order) ||
        !receipt?.profile_id ||
        receipt.publisher_actor !== event.actor.identity ||
        (event.job_ref != null &&
          !jobs.has(event.job_ref) &&
          capture.registry_status === 'unavailable')
      ) {
        flow.ambiguous = true;
      }
      for (const key of cells.keys()) {
        flow.protected.add(key);
        if (!job || !allowances.get(job.job_id)?.has(key)) {
          flow.uncovered.add(key);
          uncoveredGroup.add(key);
        }
      }
    }
    const groupKey = groupOf(deliveries[0].event.destination, deliveries[0].window);
    groups.set(groupKey, {
      crossing: uncoveredGroup.size > capture.policy.cumulative_aggregate_limit,
    });
  }
  return Object.fromEntries(
    capture.flows.map((listed) => {
      const flow = flowStates.get(flowOf(listed.identity, listed.destination, listed.window));
      if (!flow) {
        return [listed.flow_id, 'ambiguous'];
      }
      const crossing = groups.get(flow.group).crossing;
      const label = flow.ambiguous
        ? 'ambiguous'
        : flow.protected.size === 0
          ? 'benign'
          : flow.uncovered.size === 0
            ? 'sanctioned-bulk'
            : crossing
              ? 'cumulative-exfil'
              : 'benign';
      return [listed.flow_id, label];
    }),
  );
}
