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
3. **Attacker-writable fields vary per source.** Offense edits only allowlisted attacker-writable fields;
   some source schemas have no suitable free-text field to inject into (e.g. F9's listed schema), so literal
   reuse would leave the offense nothing to edit in those sources. _(Build to confirm the writable-field
   availability per source and record it here.)_

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
