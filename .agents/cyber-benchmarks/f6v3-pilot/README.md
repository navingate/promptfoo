# F6 v3 gating pilot — local probe evidence (2026-10-09)

THROWAWAY design evidence, NOT benchmark code. Supports "## Pilot result" in `../F6-V3-SPEC.md`.

- `pilot.mjs` — generator + attacker-plane probe, 3 arms (inline positive-control / full join / inv-only),
  reasoning allowed @ 8k tokens, parse only the `ANSWER:` line, endpoint hardcoded to the 34.x box ($0),
  ids randomized after shuffle, independent prompt-text solver (integrity check).
- `pilot-results.json` — raw outputs + summary.
- `analyze.mjs` — classifies full-plane picks by which join condition they fail (first-run diagnostic).

Run: `LOCAL_AI_API_KEY=... node pilot.mjs`. RESULT (controlled, 8k tokens): inline 1.00, full 0.95, inv 0.00,
integrity OK, 0 truncations. => join mechanism works (full >> inv), harness valid, winnable/solvable; BUT T1
stated-rule recon CEILINGS even the weak local model (0.95 >= 0.8 gate). B not cleared: needs harder recon
(T2) and/or crafting-as-discriminator + another pilot. NOT ready for hosted run or build.

(First uncontrolled run returned a confounded 0/0 null — no positive control, reasoning suppressed at 2k
tokens causing truncation, whole-output regex. Superseded by the controlled run above.)
