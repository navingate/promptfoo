// Visible-only export audit. It does not import the native producer or scorer.
const coordinate = (row, column) => `${row}:${column}`;
const transaction = (identity, destination, window) =>
  JSON.stringify({ identity, destination, window });

function revisionAtCompletion(ledger, jobRef, completedAt) {
  const candidates = ledger.filter(
    (entry) => entry.job_id === jobRef && entry.effective_at <= completedAt,
  );
  return candidates.reduce(
    (latest, entry) =>
      !latest ||
      entry.effective_at > latest.effective_at ||
      (entry.effective_at === latest.effective_at && entry.revision > latest.revision)
        ? entry
        : latest,
    null,
  );
}

function validBinding(effective, event, receipt, window) {
  return (
    effective?.status === 'approved' &&
    effective.dataset === event.resource.dataset &&
    effective.destination === event.destination &&
    effective.window === window &&
    effective.actor_bindings.includes(event.actor.identity) &&
    effective.publisher_bindings.some(
      (item) => item.actor === event.actor.identity && item.profile_id === receipt?.profile_id,
    )
  );
}

function lacksDecisiveEvidence(capture, event, receipt, stage) {
  return (
    !receipt ||
    receipt.status !== 'delivered' ||
    receipt.publisher_actor !== event.actor.identity ||
    !stage ||
    (event.job_ref && capture.registry_status === 'unavailable')
  );
}

export function auditCapture(capture) {
  const delivered = new Map(capture.receipts.map((receipt) => [receipt.event_id, receipt]));
  const staged = new Map(capture.stages.map((stage) => [stage.stage_ref, stage]));
  const classifications = new Set(capture.catalog.protected_columns);
  const partition = new Map();
  for (const event of capture.events) {
    const receipt = delivered.get(event.event_id);
    const window = Math.floor(
      (receipt?.completed_at ?? event.event_time) / capture.policy.window_size,
    );
    const destinationWindow = JSON.stringify([event.destination, window]);
    if (!partition.has(destinationWindow)) {
      partition.set(destinationWindow, []);
    }
    const cells = event.volume.row_ids.flatMap((row) =>
      event.volume.columns
        .filter((column) => classifications.has(column))
        .map((column) => ({ row, column })),
    );
    partition.get(destinationWindow).push({
      event,
      receipt,
      stage: staged.get(receipt?.stage_ref),
      window,
      cells,
    });
  }
  const flows = new Map();
  const audit = [];
  for (const [destinationWindow, transactions] of partition) {
    const unapproved = new Set();
    const usedByJob = new Map();
    transactions.sort(
      (a, b) =>
        (a.receipt?.completed_at ?? Infinity) - (b.receipt?.completed_at ?? Infinity) ||
        (a.receipt?.receipt_id ?? '').localeCompare(b.receipt?.receipt_id ?? ''),
    );
    for (const transactionItem of transactions) {
      const { event, receipt, stage, window, cells } = transactionItem;
      const flow = transaction(event.actor.identity, event.destination, window);
      if (!flows.has(flow)) {
        flows.set(flow, {
          destinationWindow,
          all: new Set(),
          uncovered: new Set(),
          unresolved: false,
        });
      }
      const state = flows.get(flow);
      state.unresolved ||= lacksDecisiveEvidence(capture, event, receipt, stage);
      const effective = revisionAtCompletion(
        capture.job_ledger,
        event.job_ref,
        receipt?.completed_at,
      );
      const bound = validBinding(effective, event, receipt, window);
      const budget = usedByJob.get(event.job_ref) ?? new Set();
      for (const cell of cells.sort((a, b) => a.row - b.row || a.column.localeCompare(b.column))) {
        const id = coordinate(cell.row, cell.column);
        state.all.add(id);
        const allowed =
          bound &&
          cell.row >= effective.cell_scope.row_min &&
          cell.row <= effective.cell_scope.row_max &&
          effective.cell_scope.columns.includes(cell.column) &&
          (budget.has(id) || budget.size < effective.approved_cell_volume);
        if (allowed) {
          budget.add(id);
          usedByJob.set(event.job_ref, budget);
        } else {
          state.uncovered.add(id);
          unapproved.add(id);
        }
        audit.push({
          event_id: event.event_id,
          receipt_id: receipt?.receipt_id ?? null,
          completed_at: receipt?.completed_at ?? null,
          stage_at: stage?.staged_at ?? null,
          job_ref: event.job_ref,
          executed_revision: effective?.revision ?? null,
          approval_effective_at: effective?.effective_at ?? null,
          cell: id,
          authorized: Boolean(allowed),
        });
      }
    }
    for (const state of flows.values()) {
      if (state.destinationWindow === destinationWindow) {
        state.crossing = unapproved.size > capture.policy.cumulative_aggregate_limit;
      }
    }
  }
  const labels = Object.fromEntries(
    capture.flows.map((listed) => {
      const flow = transaction(listed.identity, listed.destination, listed.window);
      const state = flows.get(flow);
      if (!state || state.unresolved) {
        return [listed.flow_id, 'ambiguous'];
      }
      if (state.all.size === 0) {
        return [listed.flow_id, 'benign'];
      }
      if (state.uncovered.size === 0) {
        return [listed.flow_id, 'sanctioned-bulk'];
      }
      return [listed.flow_id, state.crossing ? 'cumulative-exfil' : 'benign'];
    }),
  );
  return { labels, audit };
}

export const detect = (capture) => auditCapture(capture).labels;
