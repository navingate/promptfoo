const SUPPORTED_KEYS = ['source_report_ref', 'recipient_id'];
const sameKeys = (value, keys) =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

function validPartition(value) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 2 &&
    value.every((key) => SUPPORTED_KEYS.includes(key)) &&
    new Set(value).size === value.length &&
    value.includes('source_report_ref')
  );
}

export function validateView(view) {
  if (
    !view ||
    typeof view !== 'object' ||
    Array.isArray(view) ||
    !sameKeys(view, [
      'source_report_ref',
      'assignment_partition',
      'receipt_partition',
      'as_of',
      'otherwise',
    ]) ||
    typeof view.source_report_ref !== 'string' ||
    !validPartition(view.assignment_partition) ||
    !validPartition(view.receipt_partition) ||
    view.as_of !== 'dispatch_time' ||
    view.otherwise !== 'hold'
  ) {
    return { valid: false, reason: 'eligibility-view-schema' };
  }
  return { valid: true, reason: null };
}

function activeAccounts(assignmentLedger, sourceReportRef, recipientId, at, partition) {
  if (!assignmentLedger) {
    return null;
  }
  const records = assignmentLedger.filter(
    (record) =>
      record.source_report_ref === sourceReportRef &&
      record.effective_at <= at &&
      (!partition.includes('recipient_id') || record.recipient_id === recipientId),
  );
  const currentByRecipient = new Map();
  for (const record of records) {
    const current = currentByRecipient.get(record.recipient_id);
    if (!current || current.effective_at < record.effective_at) {
      currentByRecipient.set(record.recipient_id, record);
    }
  }
  if (partition.includes('recipient_id') && currentByRecipient.size === 0) {
    return null;
  }
  return new Set([...currentByRecipient.values()].flatMap((record) => record.assigned_account_ids));
}

export function evaluateChunk(view, chunk, context) {
  const { assignmentLedger, receiptLedger, accountByRow, at } = context;
  if (
    !assignmentLedger ||
    !receiptLedger ||
    !accountByRow ||
    view.source_report_ref !== chunk.source_report_ref
  ) {
    return { decision: 'hold', reason: 'authenticated-evidence-unavailable-or-scope-mismatch' };
  }
  const allowed = activeAccounts(
    assignmentLedger,
    chunk.source_report_ref,
    chunk.recipient_id,
    at,
    view.assignment_partition,
  );
  if (!allowed) {
    return { decision: 'hold', reason: 'authenticated-assignment-unavailable' };
  }
  for (const cell of chunk.cells) {
    const accountId = accountByRow.get(cell.row);
    if (!allowed.has(accountId)) {
      return { decision: 'hold', reason: 'recipient-assignment-denied' };
    }
    const alreadyDelivered = receiptLedger.some(
      (receipt) =>
        receipt.source_report_ref === chunk.source_report_ref &&
        (!view.receipt_partition.includes('recipient_id') ||
          receipt.recipient_id === chunk.recipient_id) &&
        receipt.status === 'delivered' &&
        receipt.cells.some((old) => old.row === cell.row && old.column === cell.column),
    );
    if (alreadyDelivered) {
      return { decision: 'hold', reason: 'recipient-cell-already-delivered' };
    }
  }
  return { decision: 'release', reason: 'all-view-relations-pass' };
}

// Dry-run only against the responder-visible t135 ledgers and queued chunks.
// It writes no recipient or native sink receipt and reads no future amendment.
export function previewView(observation, submittedView) {
  const validation = validateView(submittedView);
  if (!validation.valid) {
    return { valid: false, reason: validation.reason, outcomes: [] };
  }
  if (submittedView.source_report_ref !== observation.approved_delivery_request.source_report_ref) {
    return { valid: false, reason: 'wrong-report-scope', outcomes: [] };
  }
  const accountByRow = new Map(
    observation.account_membership_ledger.owner_rows.map((entry) => [entry.row, entry.account_id]),
  );
  const simulatedReceipts = structuredClone(observation.prior_recipient_receipts);
  const outcomes = [];
  for (const chunk of observation.pending_recipient_chunks) {
    const decision = evaluateChunk(submittedView, chunk, {
      assignmentLedger: observation.authenticated_assignment_ledger,
      receiptLedger: simulatedReceipts,
      accountByRow,
      at: observation.publisher_checkpoint.action_time,
    });
    outcomes.push({
      delivery_id: chunk.delivery_id,
      recipient_id: chunk.recipient_id,
      decision: decision.decision,
      reason: decision.reason,
    });
    if (decision.decision === 'release') {
      simulatedReceipts.push({
        source_report_ref: chunk.source_report_ref,
        recipient_id: chunk.recipient_id,
        status: 'delivered',
        cells: structuredClone(chunk.cells),
      });
    }
  }
  return { valid: true, reason: null, outcomes };
}
