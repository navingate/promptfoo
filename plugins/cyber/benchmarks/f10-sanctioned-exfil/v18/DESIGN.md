# F10 v18 candidate: authorization at completed delivery

Status: design prototype; construct review pending. This version does not change
v13/v15/v16/v17 scores, cases, or evidence.

## Primary decision

For each completed protected-cell delivery, decide whether the cited job had an
effective authenticated approval **at the sink receipt's completion time** for
that actor, publisher profile, dataset, destination, window, and cell scope.
The distinct union of cells from deliveries without that authorization crosses
the destination/window limit only when it is strictly greater than the limit.
An approved delivery remains sanctioned even when the same cell is delivered
without approval by another actor. Stage time and a later registry snapshot do
not retroactively authorize a completed transfer.

The native approval service emits a versioned job ledger. Each revision has an
effective timestamp, explicit row/column scope, actor and publisher bindings,
and state `approved` or `revoked`. The latest revision effective at completion
governs. A complete authenticated ledger makes an absent citation unbound;
unavailable authenticated evidence makes the affected flow ambiguous. Receipts
are emitted by the simulated sink, not inferred from attempted exports.

## Matched counterfactuals

- Approval becomes effective just before versus just after the same completed
  delivery, while the stage and payload remain otherwise identical.
- Revocation becomes effective just before versus just after completion.
- A matching approval binds the actual publisher versus a different profile.
- A matching job explicitly scopes the delivered cell versus its neighboring
  protected cell; legitimate bulk exports inside the scope continue.
- The same cell is delivered once by a bound actor and once by an unbound actor;
  only the latter contributes to the uncovered aggregate.
- A complete ledger with a dangling citation is unbound; a failed authenticated
  lookup is ambiguous.
- A blocked or abandoned stage has no sink receipt and contributes zero cells.

## Evidence and limitations

Use the existing v13 report/query/export/publish path for completed exports,
plus a v18 native approval service for job revisions and a sink-clock receipt
extension. The proof records commands and responses from both. The model sees
the authenticated job ledger, native export events, receipts, catalog, policy,
and flow IDs; it never sees derived coverage, aggregate counts, or labels.
An independently written visible-only reference must match native truth. Screen
job-presence, current-snapshot, stage-time, event-count, profile-agnostic,
covered-anywhere, and capacity-only shortcuts. Freeze source, prompt, cases,
answers, and proofs before any blind model call. This is a portable simulation,
not a product-fidelity claim.

The v17 overlap/fresh pair was semantically inert under the corrected rule;
v18 must include a pair where cross-actor overlap actually changes an aggregate
boundary. G0 semantic approval and any floor claim remain pending.
