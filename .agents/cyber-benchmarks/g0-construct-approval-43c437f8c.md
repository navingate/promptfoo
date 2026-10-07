# G0 construct approval — record + binding note (2026-10-07)

This records a real G0 **construct-reviewer** approval. It is **recorded, not manifest-bound** (see below).

## The approval

- **Verbatim record:** [`g0-construct-approval-43c437f8c.txt`](g0-construct-approval-43c437f8c.txt),
  stored byte-for-byte as received.
- **sha256 of that file:** `0c3d844b953ec845fa7438efcd5eb3ffa273ccdb2cfb13e6ad8377864851d2d2`
  (verify after checkout: `shasum -a 256 .agents/cyber-benchmarks/g0-construct-approval-43c437f8c.txt`).
- **Relayed by:** the repository owner (`navingate`), pasted into chat on 2026-10-07. The reviewer is a
  separate session; this file is the author's transcription of what the owner relayed, not a message the
  reviewer committed directly.
- **reviewer_id:** `openai-codex-gpt-6` · **author_id:** `navingate` · **role:** `construct-reviewer` ·
  **relationship:** `external-ai-reviewer` · **independent:** `true` · **decision:** `approved`.
- **reviewed_commit:** `43c437f8c753bf2a2711ea3593a3dad9aa7c10c9`.
- **Scope:** **G0 construct design only** — explicitly NOT G1 reference, G2 oracle, G3 shortcut, G4
  telemetry/twin, G5 operational, G6 calibration, or G7 claims/release.
- **Coverage:** all 18 tasks (offense + defense for F3, F4, F5, F6, F7, F8, F9, F10, F11).
- **F4 Option 2:** the reviewer confirms reading `f4-durable-consent/defense/label-policy.md` at
  `43c437f8c` and that it matches their selected Option 2.

## Caveats (read before relying on this)

1. **AI reviewer, not a human or organizational audit.** The reviewer states this itself. Under the
   repository's role-separation rule (`reviewer_id` ≠ `author_id`, relationship declared, `independent:
true`) the schema accepts it, but whether an AI construct review satisfies the intended
   "named independent reviewers" bar is the owner's call.
2. **F4 defense is partly self-approval.** The reviewer _selected_ Option 2 and specified its fields and
   counterexamples; the author transcribed that into the construct docs. So the F4-defense approval is, in
   part, the reviewer approving its own specification.
3. **F9 is covered only by the blanket "all 18" line.** F9's last task-specific verdict predates the
   `dcce97e3d` round-2 fixes; it is not separately re-stated here beyond the blanket approval.
4. **Post-approval delta.** HEAD has moved since `43c437f8c`. `git diff --stat 43c437f8c..HEAD` shows a
   single change: F6 offense `attack-chain.md` (a doc-only "gate mechanics" clarification, construct
   unchanged, audit 10/10). The reviewer has **not** seen that commit. The author pushed it after citing
   `43c437f8c` as the commit to approve.

## Why this is recorded, not manifest-bound

The audit's approval record binds a **built** commit: it requires `reviewed_commit == audited commit`, a
matching `manifest_sha256`, a matching `claim_text_sha256`, and `approved_evidence_level ==
achieved_evidence_level`. On the current G0 **scaffolds** `implementation.commit` is null,
`achieved_evidence_level` is null, and the approved-claim text does not exist. Populating
`manifest.approvals[]` / flipping `gates.G0 → pass` now fails the audit (verified in a scratchpad copy:
`APPROVAL_STALE` ×2 + `EVIDENCE_DIGEST_STALE`, still `MANIFEST_INVALID` + `EVIDENCE_FILE_MISSING` — 12
findings vs the clean 10). So the gate binds at **build time**, not now. Manifests keep `gates.G0: pending`
and the 10-finding scaffold signature; nothing is fabricated.

## Build-time (C0) re-binding protocol

When each task is built and its manifest is bound to a real commit `C0` (with evidence level + claim text),
the G0 approval is (re)issued against `C0`:

- the reviewer attests the **construct-defining files are unchanged** since `43c437f8c`, backed by an empty
  `git diff 43c437f8c..C0` over those files (for F6 offense, the attack-chain clarification above is the
  only delta and must be shown/confirmed); and
- the approval record is written with `reviewed_commit = C0`, the real `manifest_sha256`,
  `claim_text_sha256`, and `approved_evidence_level`, and only then bound into `manifest.approvals[]` with
  `gates.G0: pass`.

Any digests in a future bound record are **author-computed** at build time; the reviewer never saw manifest
digests at G0.

## Owner decision (2026-10-07) — resolves caveat 1

The repository owner **accepts this AI construct review for G0**. Caveat 1 (AI vs "named independent
reviewers") is resolved **for G0 only**: an independent AI construct review is a sufficient G0 bar here.
**G7 (claims / release) requires a human or independent-organization reviewer** — an AI review is not
sufficient for release, and that human gate also re-examines caveats 2 (F4 partial self-approval) and 3 (F9
blanket coverage). See [`review-policy.md`](review-policy.md). This decision changes no gate state now
(binding still deferred to build); it records which bar G0 and G7 must meet.
