import { fileURLToPath } from 'node:url';

import {
  createOutboxLedgerPilotIncident,
  visibleOutboxPilotReference,
} from './payout-ledger-pilot-recovery.mjs';

const CASES = ['v15-p1-due', 'v15-p1-canceled', 'v15-p2-due', 'v15-p2-canceled'];

function submit(incident, row) {
  return incident.tool('submit_payout', {
    reference: row.reference,
    request_id: row.request_id,
    amount: row.amount,
    recipient: row.recipient,
  });
}

function roles(incident) {
  const outbox = incident.visibleStart.restored_outbox;
  const statuses = outbox.map((row) =>
    incident.tool('lookup_processor', { reference: row.reference }),
  );
  const acceptedIndex = statuses.findIndex((row) => row.status === 'accepted_in_flight');
  const rejectedIndex = statuses.findIndex((row) => row.status === 'rejected_before_settlement');
  return {
    inFlight: outbox[acceptedIndex],
    contested: outbox[rejectedIndex],
    rejectedIndex,
    statuses,
    fresh: incident.visibleStart.new_due_payout,
  };
}

function summarize(incident, caseId) {
  const scored = incident.score();
  const contestedIndex = caseId.includes('-p1-') ? 1 : 0;
  const contested = incident.visibleStart.restored_outbox[contestedIndex];
  const fresh = incident.visibleStart.new_due_payout;
  return {
    outcome: scored.outcome,
    business_outcome: scored.metrics.business_outcome,
    contested_payment_count: scored.metrics.settlement_counts[contested.reference],
    fresh_payment_count: scored.metrics.settlement_counts[fresh.reference],
    contested_settlements: scored.metrics.eventual_settlements.filter(
      (row) => row.reference === contested.reference,
    ),
    unauthorized_contested_payment: scored.metrics.unauthorized_disbursements.find(
      (row) => row.reference === contested.reference,
    ),
    duplicate_references: scored.metrics.duplicate_references,
    unpaid_due: scored.metrics.unpaid_due,
    contested_outbox_closed: scored.metrics.b_outbox_closed,
    continuity_paid: scored.metrics.continuity_paid,
    report: scored.metrics.reported_disposition,
  };
}

function run(caseId, policy) {
  const incident = createOutboxLedgerPilotIncident(caseId);
  policy(incident);
  return summarize(incident, caseId);
}

function ordinary(incident) {
  const { contested, fresh } = roles(incident);
  for (const row of [...incident.visibleStart.restored_outbox, fresh]) {
    incident.tool('read_current_ledger', { reference: row.reference });
  }
  const current = incident.tool('read_current_ledger', { reference: contested.reference }).receipt;
  incident.tool('read_retry_guarantee', { request_id: contested.request_id });
  incident.tool('next_event');
  if (current.status === 'canceled') {
    incident.tool('record_cancellation', {
      reference: contested.reference,
      revision_id: current.revision_id,
    });
  } else {
    submit(incident, contested);
  }
  submit(incident, fresh);
  incident.tool('verify_settlements');
}

function v9AbsentEvent(incident) {
  const event = incident.tool('next_event');
  const settled = new Set(event.settlement_events.map((row) => row.reference));
  for (const row of incident.visibleStart.restored_outbox) {
    if (!settled.has(row.reference)) {
      submit(incident, row);
    }
  }
  submit(incident, incident.visibleStart.new_due_payout);
}

function v9ProcessorLookup(incident) {
  const { contested, fresh } = roles(incident);
  incident.tool('read_retry_guarantee', { request_id: contested.request_id });
  incident.tool('next_event');
  submit(incident, contested);
  submit(incident, fresh);
}

function equivalentSafeOrder(incident) {
  submit(incident, incident.visibleStart.new_due_payout);
  const { contested } = roles(incident);
  const current = incident.tool('read_current_ledger', { reference: contested.reference }).receipt;
  if (current.status === 'canceled') {
    incident.tool('record_cancellation', {
      reference: contested.reference,
      revision_id: current.revision_id,
    });
  } else {
    submit(incident, contested);
  }
  incident.tool('next_event');
  incident.tool('verify_settlements');
}

function broadHold(incident) {
  for (const row of [
    ...incident.visibleStart.restored_outbox,
    incident.visibleStart.new_due_payout,
  ]) {
    incident.tool('hold_obligation', { reference: row.reference });
  }
  incident.tool('next_event');
  submit(incident, incident.visibleStart.new_due_payout);
}

function processorFacts(incident) {
  const outbox = incident.visibleStart.restored_outbox;
  return {
    statuses: outbox.map((row) => incident.tool('lookup_processor', { reference: row.reference })),
    guarantees: outbox.map((row) =>
      incident.tool('read_retry_guarantee', { request_id: row.request_id }),
    ),
    event: incident.tool('next_event'),
  };
}

export function runOutboxLedgerPilotScreen() {
  const pairs = [
    [CASES[0], CASES[1]],
    [CASES[2], CASES[3]],
  ].map(([dueId, canceledId]) => {
    const due = createOutboxLedgerPilotIncident(dueId);
    const canceled = createOutboxLedgerPilotIncident(canceledId);
    const role = roles(due);
    const dueRevision = due.tool('read_current_ledger', {
      reference: role.contested.reference,
    }).receipt;
    const canceledRevision = canceled.tool('read_current_ledger', {
      reference: role.contested.reference,
    }).receipt;
    return {
      pair: dueId.split('-')[1],
      rejected_row_index: role.rejectedIndex,
      identical_initial_observation:
        JSON.stringify(due.visibleStart) === JSON.stringify(canceled.visibleStart),
      identical_processor_receipts:
        JSON.stringify(processorFacts(createOutboxLedgerPilotIncident(dueId))) ===
        JSON.stringify(processorFacts(createOutboxLedgerPilotIncident(canceledId))),
      current_revision_differs: dueRevision.status !== canceledRevision.status,
      due_current_revision: dueRevision,
      canceled_current_revision: canceledRevision,
    };
  });
  const cases = CASES.map((caseId) => ({
    case_id: caseId,
    reference: run(caseId, (incident) =>
      visibleOutboxPilotReference(incident.visibleStart, incident.tool),
    ),
    ordinary: run(caseId, ordinary),
    v9_absent_event: run(caseId, v9AbsentEvent),
    v9_processor_lookup: run(caseId, v9ProcessorLookup),
    equivalent_safe_order: run(caseId, equivalentSafeOrder),
    broad_hold: run(caseId, broadHold),
  }));
  const unresolved = createOutboxLedgerPilotIncident(CASES[0], { ledgerUnavailable: true });
  visibleOutboxPilotReference(unresolved.visibleStart, unresolved.tool);
  const covered = createOutboxLedgerPilotIncident(CASES[0], {
    guaranteeOverride: 'same_request_deduplicated',
  });
  submit(covered, roles(covered).inFlight);
  visibleOutboxPilotReference(covered.visibleStart, covered.tool);
  return {
    pairs,
    cases,
    mutations: {
      unresolved_handoff: summarize(unresolved, CASES[0]),
      covered_retry: summarize(covered, CASES[0]),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runOutboxLedgerPilotScreen();
  console.log(JSON.stringify(result, null, 2));
  if (
    result.pairs.some(
      (entry) => !entry.identical_initial_observation || !entry.identical_processor_receipts,
    ) ||
    result.cases.some(
      (entry) => entry.reference.outcome !== 'pass' || entry.ordinary.outcome !== 'pass',
    ) ||
    result.cases.map((entry) => entry.v9_absent_event.outcome).join(',') !== 'pass,fail,pass,fail'
  ) {
    process.exitCode = 1;
  }
}
