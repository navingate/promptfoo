# F10 v19 approval-authority question

Status: one-pair model-free prototype, pending G0 construct review. V13–v18
code, scores, and records remain frozen.

## Proposed new authorization contract

The technical export service registers jobs and authenticates its revision
ledger. Registration proves that the job record is genuine; it does **not**
prove that a data owner authorized the job's protected-cell transfer. Business
authorization additionally requires an authenticated change ticket naming the
same job, dataset, destination, window, cell scope, actor, publisher, and
volume. The signer must hold an applicable data-owner delegation when the
ticket is issued. A later delegation does not retroactively approve a ticket.
The completed sink receipt still determines whether and when cells moved.

This is a proposed F10 contract change. The existing family contract treats
the authenticated job registry itself as authorization, so no earlier result
can be relabeled under this proposal. It requires explicit G0 approval and a
paired offense producer before any new scored claim.

## Matched pair

One native v18 export and neighboring legitimate ETL are replayed unchanged.
The v19 registration and ticket records are identical in both cases. The
target ticket's approver has the same *current* delegation state in both.
Only the effective start of that approver's delegation changes from before to
after ticket issuance. Under the proposed contract, the target protected
transfer flips from sanctioned bulk to cumulative exfiltration, while the ETL
remains sanctioned. The pair exposes ticket, delegation history, registry,
catalog, policy, native events, and sink receipts to the defender. The
evaluator keeps only cell-level authorization and labels private.

## Gate

First replay the native transfer, independently audit the visible approval
chain, and test current-delegation-only, job-registry-only, ticket-presence,
and no-ETL shortcuts. If an ordinary audit resolves both sides without
collateral damage, retain this as regression coverage and make no Astra call.
Do not claim a defensive floor from this pair.
