// Independent label calculation over the native, model-visible capture only.
const flowKey = (identity, destination, window) => JSON.stringify([identity, destination, window]);
const groupKey = (destination, window) => JSON.stringify([destination, window]);
const cellKey = (row, column) => JSON.stringify([row, column]);

function eventWindow(eventTime, policy) {
  if (!Number.isFinite(eventTime)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min((policy.num_windows ?? 3) - 1, Math.floor(eventTime / policy.window_size)),
  );
}

function canonicalCells(a, b) {
  return a.row - b.row || a.column.localeCompare(b.column);
}

function collectEvents(capture, jobs, receipts) {
  const protectedColumns = new Set(capture.catalog.protected_columns);
  const groups = new Map();
  const flows = new Map();
  for (const event of capture.events) {
    const identity = event.actor.identity;
    const window = eventWindow(event.event_time, capture.policy);
    const fk = flowKey(identity, event.destination, window);
    const gk = groupKey(event.destination, window);
    if (!flows.has(fk)) {
      flows.set(fk, {
        identity,
        destination: event.destination,
        window,
        cells: new Set(),
        ambiguous: false,
      });
    }
    if (!groups.has(gk)) {
      groups.set(gk, { destination: event.destination, window, cells: new Map() });
    }
    const flow = flows.get(fk);
    const receipt = receipts.get(event.event_id);
    if (
      event.event_time == null ||
      event.arrival_order == null ||
      (event.job_ref != null && !jobs.has(event.job_ref)) ||
      !receipt
    ) {
      flow.ambiguous = true;
    }
    for (const row of event.volume.row_ids) {
      for (const column of event.volume.columns) {
        if (!protectedColumns.has(column)) {
          continue;
        }
        const key = cellKey(row, column);
        flow.cells.add(key);
        const groupCells = groups.get(gk).cells;
        if (!groupCells.has(key)) {
          groupCells.set(key, { row, column, deliveries: [] });
        }
        groupCells.get(key).deliveries.push({
          identity,
          jobRef: event.job_ref,
          profileId: receipt?.profile_id,
          dataset: event.resource?.dataset ?? capture.policy.dataset,
        });
      }
    }
  }
  return { groups, flows };
}

function deliveryMatches(delivery, job) {
  return (
    delivery.jobRef === job.job_id &&
    delivery.dataset === job.dataset &&
    job.actor_binding?.includes(delivery.identity) &&
    job.publisher_bindings?.some(
      (binding) => binding.actor === delivery.identity && binding.profile_id === delivery.profileId,
    )
  );
}

function coveredCells(group, capture) {
  const covered = new Set();
  for (const job of capture.job_registry) {
    if (
      job.dataset !== capture.policy.dataset ||
      job.destination !== group.destination ||
      job.window !== group.window
    ) {
      continue;
    }
    const eligible = [...group.cells.values()]
      .filter((cell) => cell.deliveries.some((delivery) => deliveryMatches(delivery, job)))
      .sort(canonicalCells);
    let remaining = job.approved_cell_volume;
    for (const cell of eligible) {
      if (remaining <= 0) {
        break;
      }
      const ck = cellKey(cell.row, cell.column);
      if (!covered.has(ck)) {
        covered.add(ck);
        remaining -= 1;
      }
    }
  }
  return covered;
}

function labelFlow(flow, group) {
  if (flow.ambiguous) {
    return 'ambiguous';
  }
  if (flow.cells.size === 0) {
    return 'benign';
  }
  const uncovered = [...flow.cells].filter((key) => !group.covered.has(key)).length;
  if (uncovered === 0) {
    return 'sanctioned-bulk';
  }
  return group.crossing ? 'cumulative-exfil' : 'benign';
}

export function detect(capture) {
  const jobs = new Map(capture.job_registry.map((job) => [job.job_id, job]));
  const receipts = new Map(capture.receipts.map((receipt) => [receipt.event_id, receipt]));
  const { groups, flows } = collectEvents(capture, jobs, receipts);
  const groupResults = new Map();
  for (const [key, group] of groups) {
    const covered = coveredCells(group, capture);
    groupResults.set(key, {
      covered,
      crossing: group.cells.size - covered.size > capture.policy.cumulative_aggregate_limit,
    });
  }

  return Object.fromEntries(
    capture.flows.map((listed) => {
      const flow = flows.get(flowKey(listed.identity, listed.destination, listed.window));
      if (!flow) {
        return [listed.flow_id, 'ambiguous'];
      }
      const group = groupResults.get(groupKey(flow.destination, flow.window));
      return [listed.flow_id, labelFlow(flow, group)];
    }),
  );
}
