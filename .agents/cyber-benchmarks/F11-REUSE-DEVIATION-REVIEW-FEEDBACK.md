# F11 all-native capture deviation — independent review feedback

Reviewed: 2026-10-10. `F11-REUSE-DEVIATION-NOTE.md` at `c26ab3dedf8653816df452b6f499123a772c51b0`, against the F11 design documents and the current shared estate implementation at `976ab0501e4a1da5dee778e54704229aca78883c`.

**Decision: accept all-native fixture sourcing in principle.** F11's primary measured decision is whether attacker-writable incident evidence changes a responder's objective action compared with a matched clean capture. Literal event bytes from F8/F9/F6/F4 are not required for that decision. An F11-native producer can still supply estate-generated captures to its own defense twin, with immutable hashes and field lineage. This does **not** establish grounding in the four earlier families' native telemetry.

The deviation cannot be recorded as a clean carry-forward of the previous G0 wording. The offense manifest's `primary_construct`, the family document, the defense incident-state document, and the suite registry explicitly promise reuse of earlier-family captures. The narrow intended outcome claims can survive, but the suite-composition and provenance claims change. Update those documents and bind a fresh, scoped G0 review to the revised design. No external data or full cross-estate integration is required.

## Corrections needed before that binding

1. **Describe the source honestly.** Say that F11 generates its own simulated incident captures, with several intrusion-pattern strata inspired by the other families. Remove statements that it imports native F8/F9/F6/F4 event bytes, retains their original provenance, or obtains lower operational cost by literal reuse. Keep the F11 offense-to-defense capture and hash contract.

2. **Either substantiate or narrow the “four intrusion kinds” claim.** The current generator varies the source pair and hop count for `recovery-sabotage`, `secret-rotation`, `change-injection`, and `consent-abuse`, while much of the event content is drawn from one generic compromise vocabulary. Those names alone do not show that the corresponding families' causal mechanisms are represented. The adoptable options are to add a few decision-relevant native facts per kind, or call these four distinct source/correlation patterns without claiming reproduction of F8/F9/F6/F4 attacks. A full service integration is unnecessary.

3. **Keep the writable value plausible for its field.** In the present generator, a signed EDR `process-arg` or file-integrity `filename` slot can contain a fluent collector recommendation such as “recommend isolate …”. A signed collection path can faithfully carry attacker-controlled process arguments or filenames, but those values should still look like arguments or filenames. Use field-shaped, capped values, or define a genuine collector-annotation field with an explicit attacker-write path. Preserve the existing separation between collection metadata and content integrity. This is a credibility check on the new all-native fixtures, not a demand for a real SIEM.

4. **Correct one factual premise in the deviation note.** The F8 event `detail` is structured, but its capture also has an `evidence.compromise_report.note` string. The note should not state that F8 has _only_ structured `detail`. Whether that report note is attacker-writable is a separate provenance question; do not add it to an allowlist without evidence.

The all-native route is practical and preserves the core poisoned-evidence construct. The resulting public claim should be limited to F11's synthetic incident estate and its F11 offense-to-defense twin. Any claim that it transfers or composes the four earlier families' **actual captured telemetry** needs the corresponding native captures and conformance evidence.
