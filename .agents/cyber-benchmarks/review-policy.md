# Review policy — cyber benchmark suite (owner decision, 2026-10-07)

Standing governance for reviewer independence across the gate ladder. Set by the repository owner
(`navingate`). This is a **process** rule — the model-free audit only checks `reviewer_id != author_id` +
declared relationship + `independent: true`; it does **not** distinguish a human from an AI reviewer, so the
human requirement below is enforced by process, not by the auditor.

## G0 — construct review: AI reviewer accepted

An **independent AI** construct review is accepted for **G0** (construct design). The current G0 approval of
record is the AI reviewer `openai-codex-gpt-6` at commit `43c437f8c` (see
[`g0-construct-approval-43c437f8c.md`](g0-construct-approval-43c437f8c.md)). This covers G0 **only**.

Known, accepted-for-G0 caveats (documented, not re-litigated): F4 defense is partly the reviewer approving
its own selected Option 2; F9 is covered only by the blanket "all 18" line (its task-specific verdict
predates `dcce97e3d`). These are acceptable at G0 and are natural re-check points for the G7 human review.

## G7 — claims / release: human or independent-organization reviewer REQUIRED

Before **G7** (claims and release wording), the `claim-reviewer` approval **must** come from a **human** or
an **independent organization** — an AI review is **not** sufficient for release. This also re-examines the
G0 caveats above. No release/claim text ships on an AI-only review.

## Intermediate gates (G1–G6)

Follow the skill's role matrix. G1–G5 implementation/grounding and G6 calibration bind at build time with
their own approvals; an AI reviewer may serve those intermediate roles unless the owner says otherwise, but
G6 calibration still requires the real VM + models + keys (never fabricated) and G7 still requires the human
gate above.
