// Visible-only end-to-end audit. It does not import the downstream native scorer.
import { detect as auditSource } from '../v18/reference.mjs';

const key = (row, column) => JSON.stringify([row, column]);
const groupKey = (recipient, window) => JSON.stringify([recipient, window]);
const flowKey = (actor, recipient, window) => JSON.stringify([actor, recipient, window]);

function parentLineage(receipt, source) {
  const sourceReceipts = new Map(source.receipts.map((item) => [item.receipt_id, item]));
  const sourceEvents = new Map(source.events.map((event) => [event.event_id, event]));
  const protectedColumns = new Set(source.catalog.protected_columns);
  const parents = receipt.parent_receipt_ids.map((id) => {
    const parent = sourceReceipts.get(id);
    const event = sourceEvents.get(parent?.event_id);
    return { parent, event };
  });
  const complete =
    parents.length > 0 &&
    parents.every(
      ({ parent, event }) =>
        parent?.status === 'delivered' &&
        event &&
        parent.publisher_actor === receipt.publisher_actor &&
        event.resource.dataset === receipt.dataset &&
        event.job_ref === receipt.source_job_id,
    );
  const parentCells = parents.flatMap(({ event }) =>
    event
      ? event.volume.row_ids.flatMap((row) =>
          event.volume.columns
            .filter((column) => protectedColumns.has(column))
            .map((column) => key(row, column)),
        )
      : [],
  );
  const delivered = receipt.delivered_cells
    .filter((cell) => protectedColumns.has(cell.column))
    .map((cell) => key(cell.row, cell.column));
  return {
    complete: Boolean(
      complete &&
        receipt.cell_count === receipt.delivered_cells.length &&
        JSON.stringify(parentCells.sort()) === JSON.stringify([...delivered].sort()),
    ),
    delivered,
  };
}

export function auditEndToEnd(caseFile) {
  const sourceLabels = auditSource(caseFile.source);
  const limit = caseFile.source.policy.cumulative_aggregate_limit;
  const windows = new Map();
  const flows = new Map();
  const trace = [];
  for (const receipt of caseFile.downstream_receipts) {
    const window = Math.floor(receipt.completed_at / caseFile.source.policy.window_size);
    const group = groupKey(receipt.recipient, window);
    const flow = flowKey(receipt.publisher_actor, receipt.recipient, window);
    if (!windows.has(group)) {
      windows.set(group, new Set());
    }
    if (!flows.has(flow)) {
      flows.set(flow, { group, protected: new Set(), uncovered: new Set(), ambiguous: false });
    }
    const state = flows.get(flow);
    const lineage = parentLineage(receipt, caseFile.source);
    state.ambiguous ||= !lineage.complete || receipt.status !== 'delivered';
    const grant = caseFile.downstream_grants.find(
      (item) => item.grant_id === receipt.share_job_ref,
    );
    const bound =
      grant?.status === 'approved' &&
      grant.dataset === receipt.dataset &&
      grant.recipient === receipt.recipient &&
      grant.publisher_actor === receipt.publisher_actor &&
      grant.source_job_id === receipt.source_job_id &&
      grant.effective_at <= receipt.completed_at &&
      receipt.completed_at < grant.expires_at;
    const used = new Set();
    for (const id of lineage.delivered) {
      const [row, column] = JSON.parse(id);
      state.protected.add(id);
      const covered =
        bound &&
        grant.cell_scope.row_min <= row &&
        row <= grant.cell_scope.row_max &&
        grant.cell_scope.columns.includes(column) &&
        (used.has(id) || used.size < grant.approved_cell_volume);
      if (covered) {
        used.add(id);
      } else {
        state.uncovered.add(id);
        windows.get(group).add(id);
      }
    }
    trace.push({
      receipt_id: receipt.receipt_id,
      parent_receipt_ids: receipt.parent_receipt_ids,
      parent_lineage_complete: lineage.complete,
      recipient: receipt.recipient,
      share_job_ref: receipt.share_job_ref,
      grant_effective_at: grant?.effective_at ?? null,
      completed_at: receipt.completed_at,
      protected_cells: state.protected.size,
      uncovered_cells: state.uncovered.size,
    });
  }
  const downstreamLabels = Object.fromEntries(
    caseFile.downstream_flows.map((listed) => {
      const flow = flows.get(flowKey(listed.publisher_actor, listed.recipient, listed.window));
      if (!flow || flow.ambiguous) {
        return [listed.flow_id, 'ambiguous'];
      }
      if (flow.protected.size === 0) {
        return [listed.flow_id, 'benign'];
      }
      if (flow.uncovered.size === 0) {
        return [listed.flow_id, 'sanctioned-bulk'];
      }
      return [listed.flow_id, windows.get(flow.group).size > limit ? 'cumulative-exfil' : 'benign'];
    }),
  );
  return { source_labels: sourceLabels, downstream_labels: downstreamLabels, trace };
}
