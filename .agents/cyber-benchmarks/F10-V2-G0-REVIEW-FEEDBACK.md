# F10 v2 — independent G0 construct review

Reviewed: 2026-10-10. Scope: `F10-V2-REVIEW-REQUEST.md` and the F10 design plus built estate at `cd1e9eced7763a7b0020905103a186730ba872db`. This is a construct review, not approval of G1–G7 evidence or an enterprise deployment claim.

**Verdict: revision required before attesting `cd1e9eced`.** The move to a per-(destination, window), cross-identity aggregate is the right repair for fan-out. The uncovered-only, distinct protected-cell unit is coherent; the fourth `benign` class closes a real label gap. I would keep those decisions. Two remaining mismatches matter to what F10 claims to test; neither requires a new service or product.

## 1. Decide whether `job_ref` binds authorization

The native event contract exposes `job_ref` as a link to the authenticated job registry, and the label policy says missing or contradictory evidence for a **cited job** is `ambiguous`. But the estate's coverage calculation ignores `job_ref`: it marks cells covered whenever a registry job matches dataset, destination, window, and actor, up to capacity. I reproduced this at the reviewed commit with one matching job and one completed export: `job_ref = null`, `job_ref = "nonexistent-job"`, and `job_ref = "valid-job"` all yielded `sanctioned-bulk` with zero uncovered cells.

Both policies can be defensible, but they are different constructs. Pick one and make the label policy, native schema, scorer, and counterexamples agree:

- **Event-bound job:** coverage requires a valid event → job reference plus the full scope/capacity match; specify whether a dangling reference is `ambiguous` or simply uncovered. Test null, valid, and dangling references with otherwise identical events.
- **Blanket job grant:** a matching registry job authorizes an actor's exports within its scope/capacity without event-level attribution. Then say explicitly that `job_ref` is non-authoritative context (or remove it), and remove the claim that a missing cited job makes the flow ambiguous solely for that reason.

The event-bound interpretation better matches the current “authenticated job” and `job_ref` wording; the blanket-grant interpretation is simpler if that is the intended enterprise policy. Do not attest one while implementing the other.

## 2. Narrow or prove the four-strategy claim

`FAMILY.md` says row-batch, column-projection, time-spread, and multi-identity fan-out are all winnable and **none redundant**. In the reviewed estate, the same two-action row-batch reference plan for seed 5 succeeds unchanged in the `row-batch`, `column-projection`, and `time-spread` worlds (40 uncovered cells in each); it fails only in `multi-identity-fanout` (20 uncovered cells). These three worlds give the first identity the same full access scope, and the time-spread case does not require spanning or choosing a window to win. The scripted reference's `≥2 of 4` floor screen also cannot establish four distinct strategy demands.

The low-complexity fix is to describe row/column/time as **alternative action patterns and detection counterfactuals**, not four independent offense hurdles. Keep the genuine multi-identity partition as the distinct access-scope challenge, and report results by family without claiming four orthogonal capabilities. If four nonredundant offense strategies are essential to the claim, add explicit, model-visible constraints and a cross-family substitution test that shows a row-batch plan cannot win the column/time cases. Avoid artificial constraints solely to inflate difficulty.

## Contract cleanup before the gate record

`FAMILY.md` and both threat models still say `pair v1` / `f10-exfil-events-v1`, while both manifests and the estate declare pair version `2` and `f10-exfil-events-v2`. Correct those stale statements, and update the scope/counterexample wording after deciding the job-link semantics. This is mechanical, but the fixed-commit G0 record must describe one contract.

After these bounded corrections, a focused re-review of only the changed authorization semantics and claim wording should suffice. The aggregate-key, distinct-cell, uncovered-only, and four-label decisions do not need to be reopened.
