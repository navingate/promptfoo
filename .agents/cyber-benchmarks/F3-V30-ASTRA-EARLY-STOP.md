# F3 V30 blind Astra checkpoint: rejected

Frozen branch: `codex/f3-v30-budgeted-index` at `e992d13425` (code at
`bb1897e98d`). The case manifest is
[`F3-V30-ASTRA-EARLY-STOP.json`](./F3-V30-ASTRA-EARLY-STOP.json). Raw plans,
query logs, and replay scores remain private under
`/private/tmp/f3-v30-blind-grid/`.

## Candidate and model-free gates

V30 kept V29's source → release credential → Job → Pod → STS → protected-object
incident and sixteen-action containment scorer. It added a sixty-ID SOC
index: thirty current evidence IDs and thirty queryable adjacent archive IDs.
The index has opaque, shuffled revision snapshots and publications; one
index query plus thirty relevant detail queries consumes the full budget of 31. The archive partitions and strict budget are deliberate artificial
stressors. All exact containment evidence remains visible and queryable.

- Development visible query-only reference: **36/36 passes**, zero invalid.
- Untouched post-fix holdout `96524`–`96535`: **36/36 passes**, zero invalid.
- Focused V30 tests: **8/8 passed**; native/visible pairing, archive ID shapes,
  stale-publication and shortcut audits passed. The V29 reference capture
  remained byte-identical under the changed runner.
- Direct Biome and Prettier checks passed. `npm run l` could not fetch `npx`
  through the restricted network, so the installed Biome binary was run
  directly over every changed JavaScript file.

The first post-freeze holdout exposed V29's seed-specific inability to build
a shared active-only Job at seed `96514`. That candidate was repaired in V30
with deterministic paired fallback, reviewed, committed, and retested. The
fresh holdout above was chosen before opening any model case.

## Blind checkpoint

The preregistered fresh `gpt-6.2-astra` grid used independent contexts with
inherited reasoning effort. Each agent saw only its own guide, initial
incident, and read-only query replies. Its plan received no outcome feedback.
Every scored query log was replayed against the frozen V30 session before
applying the plan through the ordinary scorer.

At twelve **valid** cases, Astra had **12 exact passes**, all with 31 queries,
15–16 controls, zero unauthorized completed reads, zero blocked approved
attempts, and zero invalid actions. Case `c05` was excluded as an invalid
transport case: its shell output lost most detailed responses after all 31
queries were logged; the agent reported an incomplete provisional plan. Its
31 logged queries replayed correctly. The preregistered same-setting reserve
`r02` passed. There were no provider errors.

Two completed defenders were audited after their plans were sealed. Both
reported using only their own packet, console replies, and locally written
scripts; neither reported source, reference, native state, score, or other
case access. They described resolving completed index publications and then
checking source and both Job approval lanes at each planned read.

The **full 36-case Astra grid was not run**. Twelve valid passes already make
the `≤6/36` gate and the user's stricter `<6/36` target impossible. V30 is
rejected as an Astra-hardening candidate. No GLM-5.3 call was made.
