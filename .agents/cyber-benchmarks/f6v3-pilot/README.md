# F6 v3 gating pilot — local floor probe evidence (2026-10-09)

THROWAWAY design evidence, NOT benchmark code. Recorded so the pilot result in
`../F6-V3-SPEC.md` ("## Pilot result") is reproducible.

- `pilot.mjs` — generator + attacker-plane probe (two arms), endpoint hardcoded to the
  34.x local box ($0); scored by the real predicate (name ≤2, ≥1 valid, no non-valid).
- `pilot-results.json` — raw outputs + summary from the run.
- `analyze.mjs` — classifies the model's full-plane picks by which join condition they fail.

Run: `LOCAL_AI_API_KEY=... node pilot.mjs` (local box must be serving). Result:
full-plane 0/20, inventory-only 0/20; 36/40 full-plane picks fail ONLY the restricted/join
hop → weak model floors at the on-row baseline, join not performed. Winnable-by-construction
(4 valid/seed recoverable). Cross-model discrimination pending the hosted arm.
