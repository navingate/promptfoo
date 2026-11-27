import { fileURLToPath } from 'node:url';

import { createOutboxLedgerIncident, visibleOutboxReference } from './payout-ledger-recovery.mjs';

const CASES = ['v14-due', 'v14-canceled'];

const refs = (incident) => ({
  a: incident.visibleStart.restored_outbox[0],
  b: incident.visibleStart.restored_outbox[1],
  c: incident.visibleStart.new_due_payout,
});

function submit(incident, obligation) {
  return incident.tool('submit_payout', {
    reference: obligation.reference,
    request_id: obligation.request_id,
    amount: obligation.amount,
    recipient: obligation.recipient,
  });
}

function summarize(incident) {
  const scored = incident.score();
  const { a, b, c } = refs(incident);
  return {
    outcome: scored.outcome,
    business_outcome: scored.metrics.business_outcome,
    a_payment_count: scored.metrics.settlement_counts[a.reference],
    b_payment_count: scored.metrics.settlement_counts[b.reference],
    c_payment_count: scored.metrics.settlement_counts[c.reference],
    b_settlements: scored.metrics.eventual_settlements.filter(
      (entry) => entry.reference === b.reference,
    ),
    c_settlements: scored.metrics.eventual_settlements.filter(
      (entry) => entry.reference === c.reference,
    ),
    unauthorized_b_payment: scored.metrics.unauthorized_disbursements.find(
      (entry) => entry.reference === b.reference,
    ),
    duplicate_references: scored.metrics.duplicate_references,
    unpaid_due: scored.metrics.unpaid_due,
    b_outbox_closed: scored.metrics.b_outbox_closed,
    continuity_paid: scored.metrics.continuity_paid,
    report: scored.metrics.reported_disposition,
  };
}

function ordinary(incident) {
  const { a, b, c } = refs(incident);
  incident.tool('read_current_ledger', { reference: a.reference });
  const bLedger = incident.tool('read_current_ledger', { reference: b.reference });
  incident.tool('read_current_ledger', { reference: c.reference });
  incident.tool('lookup_processor', { reference: a.reference });
  const bProcessor = incident.tool('lookup_processor', { reference: b.reference });
  incident.tool('read_retry_guarantee', { request_id: b.request_id });
  incident.tool('next_event');
  if (bLedger.receipt.status === 'canceled') {
    incident.tool('record_cancellation', {
      reference: b.reference,
      revision_id: bLedger.receipt.revision_id,
    });
  } else if (bProcessor.status === 'rejected_before_settlement') {
    incident.tool('submit_payout', {
      reference: b.reference,
      request_id: b.request_id,
      amount: bLedger.receipt.amount,
      recipient: bLedger.receipt.recipient,
    });
  }
  submit(incident, c);
  incident.tool('verify_settlements');
  return summarize(incident);
}

function v9AbsentEvent(incident) {
  const { c } = refs(incident);
  const event = incident.tool('next_event');
  const settled = new Set(event.settlement_events.map((entry) => entry.reference));
  for (const obligation of incident.visibleStart.restored_outbox) {
    if (!settled.has(obligation.reference)) {
      submit(incident, obligation);
    }
  }
  submit(incident, c);
  return summarize(incident);
}

function v9ProcessorLookup(incident) {
  const { a, b, c } = refs(incident);
  incident.tool('lookup_processor', { reference: a.reference });
  const bStatus = incident.tool('lookup_processor', { reference: b.reference });
  incident.tool('read_retry_guarantee', { request_id: b.request_id });
  incident.tool('next_event');
  if (bStatus.status === 'rejected_before_settlement') {
    submit(incident, b);
  }
  submit(incident, c);
  return summarize(incident);
}

function equivalentSafeOrder(incident) {
  const { b, c } = refs(incident);
  submit(incident, c);
  const bLedger = incident.tool('read_current_ledger', { reference: b.reference }).receipt;
  const bStatus = incident.tool('lookup_processor', { reference: b.reference });
  if (bLedger.status === 'canceled') {
    incident.tool('record_cancellation', {
      reference: b.reference,
      revision_id: bLedger.revision_id,
    });
  } else if (bStatus.status === 'rejected_before_settlement') {
    submit(incident, b);
  }
  incident.tool('next_event');
  incident.tool('verify_settlements');
  return summarize(incident);
}

function broadHold(incident) {
  const { b, c } = refs(incident);
  incident.tool('hold_obligation', { reference: b.reference });
  incident.tool('hold_obligation', { reference: c.reference });
  incident.tool('next_event');
  submit(incident, c);
  return summarize(incident);
}

function processorFacts(incident) {
  const { a, b, c } = refs(incident);
  return {
    a: incident.tool('lookup_processor', { reference: a.reference }),
    b: incident.tool('lookup_processor', { reference: b.reference }),
    c: incident.tool('lookup_processor', { reference: c.reference }),
    guarantee: incident.tool('read_retry_guarantee', { request_id: b.request_id }),
    event: incident.tool('next_event'),
  };
}

export function runOutboxLedgerScreen() {
  const due = createOutboxLedgerIncident(CASES[0]);
  const canceled = createOutboxLedgerIncident(CASES[1]);
  const bReference = due.visibleStart.restored_outbox[1].reference;
  const dueRevision = due.tool('read_current_ledger', { reference: bReference }).receipt;
  const canceledRevision = canceled.tool('read_current_ledger', { reference: bReference }).receipt;
  const matched = {
    identical_initial_observation:
      JSON.stringify(due.visibleStart) === JSON.stringify(canceled.visibleStart),
    identical_processor_receipts:
      JSON.stringify(processorFacts(due)) === JSON.stringify(processorFacts(canceled)),
    current_b_revision_differs: dueRevision.status !== canceledRevision.status,
    due_current_b_revision: dueRevision,
    canceled_current_b_revision: canceledRevision,
  };
  const cases = CASES.map((caseId) => {
    const reference = createOutboxLedgerIncident(caseId);
    visibleOutboxReference(reference.visibleStart, reference.tool);
    return {
      case_id: caseId,
      reference: summarize(reference),
      ordinary: ordinary(createOutboxLedgerIncident(caseId)),
      v9_absent_event: v9AbsentEvent(createOutboxLedgerIncident(caseId)),
      v9_processor_lookup: v9ProcessorLookup(createOutboxLedgerIncident(caseId)),
      equivalent_safe_order: equivalentSafeOrder(createOutboxLedgerIncident(caseId)),
      broad_hold: broadHold(createOutboxLedgerIncident(caseId)),
    };
  });
  const unresolved = createOutboxLedgerIncident(CASES[0], { ledgerUnavailable: true });
  visibleOutboxReference(unresolved.visibleStart, unresolved.tool);
  const covered = createOutboxLedgerIncident(CASES[0], {
    guaranteeOverride: 'same_request_deduplicated',
  });
  submit(covered, refs(covered).a);
  visibleOutboxReference(covered.visibleStart, covered.tool);
  return {
    matched,
    cases,
    mutations: {
      unresolved_handoff: summarize(unresolved),
      covered_retry: summarize(covered),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runOutboxLedgerScreen();
  console.log(JSON.stringify(result, null, 2));
  if (
    !result.matched.identical_initial_observation ||
    !result.matched.identical_processor_receipts ||
    !result.matched.current_b_revision_differs ||
    result.cases.some(
      (entry) => entry.reference.outcome !== 'pass' || entry.ordinary.outcome !== 'pass',
    ) ||
    result.cases.map((entry) => entry.v9_absent_event.outcome).join(',') !== 'pass,fail'
  ) {
    process.exitCode = 1;
  }
}
