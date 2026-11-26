// V17 policy: authorization belongs to a delivery, while the cumulative counts
// distinct cells delivered without authorization in each destination/window.
const cellKey = ({ row, col }) => JSON.stringify([row, col]);
const flowKey = (event, window) =>
  JSON.stringify([event.actor.identity, event.destination, window]);
const windowFor = (event, policy) => Math.floor(event.event_time / policy.window_size);
const orderCells = (a, b) => a.row - b.row || a.col.localeCompare(b.col);

function matches(event, job, window) {
  return (
    event.job_ref === job.job_id &&
    event.resource.dataset === job.dataset &&
    event.destination === job.destination &&
    window === job.window &&
    job.actor_binding.includes(event.actor.identity) &&
    job.publisher_bindings.some(
      (binding) =>
        binding.actor === event.actor.identity &&
        binding.profile_id === event._publisher_profile_id,
    )
  );
}

export function labelNative(events, jobs, policy, { registryComplete = true } = {}) {
  const groups = new Map();
  for (const event of events) {
    const window = windowFor(event, policy);
    const key = JSON.stringify([event.destination, window]);
    if (!groups.has(key)) {
      groups.set(key, { window, events: [], flows: new Map() });
    }
    const group = groups.get(key);
    group.events.push(event);
    const fk = flowKey(event, window);
    if (!group.flows.has(fk)) {
      group.flows.set(fk, {
        identity: event.actor.identity,
        destination: event.destination,
        window,
        protected: new Set(),
        uncovered: new Set(),
        ambiguous: false,
      });
    }
  }
  const results = [];
  for (const group of groups.values()) {
    const authorizedByJob = new Map();
    for (const job of jobs) {
      const eligible = new Map();
      for (const event of group.events) {
        if (matches(event, job, group.window)) {
          for (const cell of event._delivered) {
            eligible.set(cellKey(cell), cell);
          }
        }
      }
      authorizedByJob.set(
        job.job_id,
        new Set(
          [...eligible.values()].sort(orderCells).slice(0, job.approved_cell_volume).map(cellKey),
        ),
      );
    }
    const uncoveredUnion = new Set();
    for (const event of group.events) {
      const flow = group.flows.get(flowKey(event, group.window));
      const cited = jobs.find((job) => job.job_id === event.job_ref);
      if (
        !Number.isFinite(event.event_time) ||
        !Number.isFinite(event.arrival_order) ||
        (event.job_ref != null && !cited && !registryComplete) ||
        (event.job_ref != null && event._publisher_profile_id == null)
      ) {
        flow.ambiguous = true;
      }
      for (const cell of event._delivered) {
        const key = cellKey(cell);
        flow.protected.add(key);
        if (
          !cited ||
          !matches(event, cited, group.window) ||
          !authorizedByJob.get(cited.job_id)?.has(key)
        ) {
          flow.uncovered.add(key);
          uncoveredUnion.add(key);
        }
      }
    }
    const crossing = uncoveredUnion.size > policy.cumulative_aggregate_limit;
    for (const flow of group.flows.values()) {
      results.push({
        ...flow,
        uncovered_cells: flow.uncovered.size,
        crossing,
        label: flow.ambiguous
          ? 'ambiguous'
          : flow.protected.size === 0
            ? 'benign'
            : flow.uncovered.size === 0
              ? 'sanctioned-bulk'
              : crossing
                ? 'cumulative-exfil'
                : 'benign',
      });
    }
  }
  return results;
}
