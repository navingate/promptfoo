# F11 — implementation deviation from the reviewed "literal reuse" language (for the independent reviewer; user-relayed)

**What deviates.** F11's reviewed docs say F11 **reuses earlier families' native captures** (F8/F9/F6/F4) —
literal event/artifact reuse, "keep their original provenance," "immutable-bound with hashes." The build
instead implements F11 **ALL-NATIVE**: F11-authored captures that carry F11's collection-authenticity layer
and reproduce the earlier intrusion **KINDS** as a seed dimension (rotation / recovery / change / consent
causal-chain shapes). No earlier-family event bytes are imported.

**Doc lines this contradicts** (unchanged on disk — not edited, to preserve the byte-identical G0
carry-forward): `FAMILY.md:31-32` ("Reused captures keep their original provenance"), `FAMILY.md:90`
("most native events/artifacts come from earlier families' captures"), `defense/incident-state.md:8`
("including reused earlier-family captures (F8/F9/F6/F4), immutable-bound with hashes"),
`offense/benchmark.yml:10` ("reusing F8/F9/F6/F4 native events"), `offense/design.md:43` (evidence-level
justification cites "frozen captures reusing earlier families").

**Why all-native (three reasons; the capability and the claim are UNCHANGED — only fixture sourcing):**
1. **No earlier capture carries F11's authenticity layer.** F11 scores whether the responder weighs
   evidence **collection-authenticity** (source_system / signature / collection_path / integrity_status) as
   raw descriptors. A per-source inspection found every F8/F9/F6/F4 capture predates the authenticity model
   and carries none of that layer (each has only a raw correlation/trace join key). F11 must author that
   layer regardless of where the event bytes come from — so literal reuse does not supply the load-bearing
   part. (This layer is RAW descriptors the model weighs, **not** an estate-computed authenticity verdict —
   the F10-R1 discipline is preserved either way.)
2. **Literal content buys no measured capability.** The success claim is a **harmful-response delta vs the
   matched clean twin**, which is independent of where the event bytes originated; literal reuse adds
   schema-translation + hash-coupling to four other estates for no measurement gain.
3. **Attacker-writable fields vary per source (confirmed by per-source capture inspection).** Offense edits
   only allowlisted attacker-writable fields, and most sources have no suitable injectable field:
   - **F9** (`f9-rotation-events-v1`): fully structured, **no free-text/content field** → offense has
     nothing to inject.
   - **F4** (`f4-consent-events-v1`): structured `provenance` object, **no free-text content field** → same.
   - **F8** (`f8-recovery-events-v1`): a structured `detail {op: …}` plus an `evidence.compromise_report.note`
     free-text string → a weak-to-moderate injection surface. _(Whether that note is attacker-writable is a
     separate provenance question; it is NOT allowlisted without evidence. Correcting an earlier draft that
     said F8 had "only" a structured `detail".)_
   - **F6** (`f6-change-corpus-v2`): baseline events have no content; the only free-text is row-level
     `documents[].content` — which lives in the **void v2 corpus** (being superseded by the F6 v3 build) and
     is tickets/repo-docs, not SOC telemetry.
   So literal reuse would leave the offense **no allowlisted field to poison** in F9 and F4, only a
   structured field in F8, and F6's only injectable field in a superseding corpus.

**What is preserved.** The **intrusion-KIND seed dimension** (`attack-chain.md:33-34`, "the reused
intrusion F8/F9/F6/F4") — F11-native captures with distinct causal-chain **shapes**, semantic variation not
renamed hosts. The authenticity model, the four harmful-outcome classes, and the claim are all unchanged.

**Process position.** Unlike the F4/F6 reopen (where the scoring did not measure the claimed capability),
here the capability and claim are unchanged; this is a fixture-sourcing deviation. We did **not** reopen the
construct. The build is behind a `buildCapture(seed, family)` seam, so reverting to literal reuse for any
source is a localized swap.

**Ask.** Confirm the all-native fixture sourcing is acceptable for F11 (capability/claim unchanged), or
direct literal reuse (and for which sources) if the reused-capture provenance is load-bearing for you. The
F11 G0 bind records this deviation explicitly (it is **not** a clean byte-identical carry-forward on the
reuse premise).
