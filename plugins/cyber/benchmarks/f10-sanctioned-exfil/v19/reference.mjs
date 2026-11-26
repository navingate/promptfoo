// Ordinary visible-only approval audit, independent of the v19 native sink scorer.
import { detect as auditExports } from '../v18/reference.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function ticketCoversJob(ticket, revision) {
  return (
    ticket?.decision === 'approved' &&
    ticket.approval_ref === revision.approval_ref &&
    ticket.job_id === revision.job_id &&
    ticket.dataset === revision.dataset &&
    ticket.destination === revision.destination &&
    ticket.window === revision.window &&
    ticket.approved_cell_volume === revision.approved_cell_volume &&
    same(ticket.actor_bindings, revision.actor_bindings) &&
    same(ticket.publisher_bindings, revision.publisher_bindings) &&
    same(ticket.cell_scope, revision.cell_scope)
  );
}

function signerHadAuthority(ticket, history) {
  return history.some(
    (grant) =>
      grant.signer === ticket.signer &&
      grant.dataset === ticket.dataset &&
      grant.destination === ticket.destination &&
      grant.authority === 'approve-protected-export' &&
      grant.valid_from <= ticket.issued_at &&
      ticket.issued_at < grant.valid_until,
  );
}

export function auditApproval(capture) {
  const tickets = new Map(capture.change_tickets.map((ticket) => [ticket.approval_ref, ticket]));
  const traced = capture.job_ledger.map((revision) => {
    const ticket = tickets.get(revision.approval_ref);
    const scopeMatches = ticketCoversJob(ticket, revision);
    const authorityAtIssue = ticket && signerHadAuthority(ticket, capture.delegation_history);
    return {
      job_id: revision.job_id,
      revision: revision.revision,
      approval_ref: revision.approval_ref,
      ticket_id: ticket?.ticket_id ?? null,
      signer: ticket?.signer ?? null,
      ticket_issued_at: ticket?.issued_at ?? null,
      scope_matches: scopeMatches,
      authority_at_issue: Boolean(authorityAtIssue),
      accepted: Boolean(scopeMatches && authorityAtIssue),
    };
  });
  const accepted = new Set(traced.filter((entry) => entry.accepted).map((entry) => entry.job_id));
  const exportView = {
    ...capture,
    job_ledger: capture.job_ledger.filter((revision) => accepted.has(revision.job_id)),
  };
  return { labels: auditExports(exportView), traced };
}

export const detect = (capture) => auditApproval(capture).labels;
