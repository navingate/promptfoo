# F9 v24 defense — independent G0 re-review verdict

**G0 verdict: APPROVE G0** for the revised F9 v24 defense _design_.

**Reviewer:** `codex-gpt-6-f9-g0-independent-2026-11-27`, the independent AI subagent who issued R1; I did not author the proposal. I reviewed commit `89c83c9f31b35a557ac00be05fcf8d4fc22977be`, specifically `plugins/cyber/benchmarks/f9-secret-rotation/v24/G0-PROPOSAL.md` (SHA-256 `dc8efc78b677b4f594b30f3d2cb40eeac048e6bd22f7e3c08022b735b466ea89`). The supplemental review request is outside that target.

The revision resolves the three R1 blockers. Removing origin blocking avoids a control that would also affect a legitimate consumer. Action-time mandates, partial-authority deferral, a deterministic in-flight completion rule, source retirement, and route replay give the proposed response a decidable outcome. The declared derived attribution view preserves v23 source IDs and omitted-parent provenance without presenting a trimmed graph as native capture. Matched benign and failure strata test causal read approval, response authority, continuity, and supported closure. This supports a **narrow synthetic safe-rotation response construct**, including a reported exposure window; it does not establish zero-exposure containment or real-product transfer.

**Implementation boundary:** Defender-visible probe results and IDs must be available _before_ a responder claims closure. The scorer's independent replay can validate outcomes, but private replay alone cannot support the responder's cited final status. Verify that boundary, field lineage, redaction, negative mutations, and shortcut resistance at the later gates.

This approves **G0 only**. G1 reference, G2 oracle resistance, G3 shortcuts, G4 grounding, G5 implementation, G6 calibration, and G7 claims/release remain unapproved. I made no edits or model calls. Historical v23 offense and older defense scores do not transfer to v24.

## Provenance and binding

The text above transcribes the verdict returned by the separate reviewer session. It is not an approval authored by the chain owner. The reviewer relationship is `independent-ai-construct-reviewer`; the author is the F9 chain owner. The approval is a design record, not a manifest-bound gate record. Any later bound G0 approval must name the built commit and verified design-byte carry-forward; it cannot claim the reviewer examined later implementation bytes.
