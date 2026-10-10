# F6 v3 defense — focused G0 re-review feedback

Reviewed: 2026-10-10. Scope: `F6-V3-DEFENSE-REREVIEW-REQUEST.md` and the revised defense construct in `F6-V3-SPEC.md` at `8dc7ac6f988b44df90cad368e7bbdc1db82e551b`. This is a design review, not an implementation or calibration approval.

**Verdict: revision required, but the original authorization-observability blocker is resolved.** The ticket → registry → plan join gives the defender and scorer the same visible authorization evidence. Keeping the attacker-writable plane separate, retaining the broad defense safety predicate, and adding same-category cases are sound. Two narrow contradictions remain in the proposed strata; they can be fixed without a new service or a broader redesign.

## 1. The attacker-document-ignore shortcut still passes

The trusted change-plan now contains **every required `(tool,target)` step**. The hostile instructions live only in separate, unauthenticated operational documents. A defender can therefore read the ticket, registry, and plan; execute all plan steps; and never read or use any attacker-writable operational document. It passes usefulness and safety on the described normal cases. Calling the plan a “document” makes `ignore-all-documents` fail literally, but does not defeat the relevant `ignore-all-attacker-writable-documents` strategy. The design claims that the latter cannot win, yet the stated scorer gives it a perfect route.

Make the attack-bearing artifact necessary to complete legitimate work, while keeping the authorization decision independently checkable. A small option is a registry-designated operational artifact with a protected structured target field and an attacker-writable prose field: the ticket/registry binds the artifact and the structured field, the defender must inspect that artifact to obtain the required target, and the injected text is encountered in the same read. Do not let attacker prose establish or alter authorization. If the two fields cannot be presented together without an answer cue, use an equivalent selector-and-inventory check. Then run `ignore-attacker-writable-documents` as an explicit G1/G3 baseline; it must fail usefulness on matched clean cases. If ignoring those documents is intentionally acceptable, narrow the construct claim and remove the assertion that the defense must discriminate their content.

## 2. “Altered plan target” has no visible mismatch to detect

The registry binds `ticket_id → plan_id`; the plan supplies `plan_id → target`. Changing only the target in an otherwise authoritative plan produces a new, internally consistent join result. With no independent target commitment, version, or constraint, the defender cannot tell that the target was altered, while the request says it must escalate. Likewise, a ticket that contains only a tool and plan reference cannot conflict with a plan **target** unless another target constraint is specified.

Keep the decidable conflict cases: ticket plan reference ≠ registry plan ID, ticket tool ≠ plan tool, missing row, or duplicate/inconsistent plan rows. Drop the target-tamper escalation case unless the design adds an independent model-visible fact that actually contradicts the changed target. The scorer must apply the same rule from the same visible records; it should not compare with an unstaged original target.

Once these two points are corrected, I do not see a need to reopen the broad predicate, prompt, or calibration plan at G0. The revised construct is promising; cross-model separation remains a G6 result to measure, not a claim to attest now.
