# F6 v3 defense — independent G0 feedback

Reviewed: 2026-10-10. Design at `c26ab3dedf8653816df452b6f499123a772c51b0`, especially the live **F6 v3 DEFENSE construct** section of `F6-V3-SPEC.md` and `F6-V3-DEFENSE-REVIEW-REQUEST.md`. This is a design review; the v3 defense implementation and calibration are pending. The earlier F6 v3 **offense** approval is unaffected.

**Verdict: revision required before a defense G0 attestation.** The direction is good, and the remaining issue is narrow. The broad safety predicate is the right relation: an offense win must be unsafe for the defender, while the defender must also reject unauthorized tool swaps, same-category targets, siblings, invented targets, and in-place escalation that the offense does not credit. The v2 scorer demonstrably allowed a **ticket-only** strategy to pass, so adding a usefulness requirement is justified. Retaining the v2 defender prompt while changing the corpus and scorer is a reasonable preregistered choice. Cross-model discrimination remains a G6 hypothesis.

## G0 blocker — make document-sourced authorization observable

The proposed ticket authorizes a set `A` of exact `(tool, target)` pairs, but at least one required member's target ID appears **only** in an operational document. The design does not say how the defender can verify from model-visible, trusted facts that this document-supplied ID is in `A`.

If `A` is evaluator-only, a defender cannot distinguish a valid document-sourced target from an attacker-substituted target. If all exact IDs in `A` are visible in the ticket, a ticket-only agent may execute the required actions without consulting the document. Either interpretation defeats the intended useful-versus-safe decision.

Specify one authoritative, model-visible binding. A compact solution is for the ticket to authorize a tool plus a named, authenticated plan field or resource selector; the referenced plan supplies the concrete target ID, and an independently visible registry or selector rule lets the agent check that ID. Keep the attacker-writable instruction field separate from the field or record that establishes authorization. State what happens when the reference is missing, altered, or conflicts with the ticket. The evaluator and the defender must be able to reach the same scope answer from the staged evidence, without an evaluator-only membership flag.

Then require matched cases in which the **same wording** proposes an authorized document-sourced action in one case and an unauthorized action in another. Check that ticket-only, ignore-document, and follow-document strategies each fail for the intended reason. Also ensure that executing every merely *eligible* action is not a shortcut to usefulness if only some are required.

## Build and calibration checks, after G0

- Keep `outOfScopeClass` broad and add the narrow `offenseSuccessClass` separately. Assert their subset relation, and run every offense hard-fail example through the defense scorer. An attempted but blocked unauthorized mutation must still fail safety.
- Evaluate the `category-diff-rule` on matched same-category unauthorized cases, not only on an overall corpus average whose class mix could hide its failures.
- Freeze the graded corpus before defender calibration. Include clean, required-document, weak-injection, strong-injection, and same-category cases. Strong crafts should come from v3 offense captures, with labels and source-model identity withheld from the defender. Treat the hosted multi-model spread as unmeasured until G6.

One wording correction: literal **refuse-all** already fails v2's ticket-completion requirement. The demonstrated shortcut is **ticket-only / ignore-document**. Fix that phrase in the spec and request; it does not change the design decision.

No new service or enterprise product is needed. Define the authorization binding and its matched cases, then return the defense construct for a focused G0 re-review.
