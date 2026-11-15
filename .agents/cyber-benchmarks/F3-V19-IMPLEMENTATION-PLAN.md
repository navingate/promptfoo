# F3 v19 causal-provenance containment — implementation plan (DRAFT)

The [design](F3-V19-DEFENSE-DESIGN.md) defines a bounded response candidate.
V19 must not change v17 detection or v18's frozen local score. The build
reuses the in-process v18 response plane and adds only causal source
provenance as an independent threat condition.

## Code boundary

1. `v19/producer.mjs` builds a four-Job episode through a narrow opt-in
   selection seam in v18: three release histories (one source-unapproved,
   two source-approved) plus one independently scheduled neighbor. Assign
   the Job-unapproved future to one of the two source-approved release Jobs,
   keep the other clean, and vary the release slot ordering independently.
   Keep the three release Jobs' plan shape matched within an episode and
   a clean planned read on the third. Then bind each
   release Job to its native source action and exact
   object-write/fetch/token lineage, retaining the synced read as
   corroboration. Remap every model-visible event ID and exact reference
   to an independent opaque ID after freezing the native episode. It exposes
   no new answer field. It may add a source-bad/no-future case without changing v18's
   default seven-case distribution. Never copy a historical
   `captured.authorized` verdict into the scorer's input.
   Add a coherent second-object mapping under the same reaching controller
   for selected source histories: authenticated write, reconcile, completed
   fetch of the same remote secret and credential version from a distinct
   object UID/revision, and ordinary sync evidence that cannot be mistaken for the token actor's
   pre-redemption read. Vary mapping order and writer approval independently
   of the causal source. Preserve native offense-derived causal events and
   describe the extra mapping as defense-authored background context.
2. `v19/runtime.mjs` composes v18's frozen action replay with an
   independently recomputed source-approval predicate. It validates each
   native causal link, computes source authorization at historical fetch
   time from grants and membership, and recomputes future unsafe completed
   reads plus clean-Job preservation. It never imports the visible
   reference interpreter.
3. `v19/reference.mjs` takes only the visible projection. It resolves the
   three release-token source decisions using the existing v17 correlation
   grammar or an equally bounded visible-only join, then asks the v18
   containment planner to include the causally tainted Job UIDs. Refactor a
   tiny optional `unsafeJobUids` input into v18's planner rather than
   copying the full planner.
4. Refactor v18's response interface minimally to permit injected
   producer/replay/planner functions for a versioned v19 wrapper. Keep the
   default v18 behavior byte-for-byte equivalent. Add `v19/guide.mjs`,
   `v19/README.md`, runner registration, and focused tests.

## Tests and local gates

- Start with failing tests for source-provenance causal validation, exact
  writer/revision, membership strictly before fetch, later approval not
  retroactive, independent scheduled Job behavior, and v18 regression.
- Check the four source × Job approval combinations. Include a source-bad
  Job with no future plan, unrelated bad source fetch, matched clean
  causal fetch, and active/renewal action effects.
- Verify a no-action replay actually completes each threat-bearing future
  read under runtime IAM. Check that the native scorer and visible reference
  agree on disjoint 12-seed × three-setting development and holdout grids.
- Run visible-only shortcut strategies on a separately frozen 36-episode
  grid; report individual /36 and three-setting exact /12, including v18's
  Job-only planner, first-listed and any-two-release choices, blanket release
  shutdown, event-ID-prefix, literal-revision-2, and latest-fetch heuristics.
  A low model score cannot be called a capability floor
  if the simple shortcuts reach the same score.
- Recursively scan the fully staged guide/initial/inspect/action feedback
  for private source verdicts, future outcome fields, and causal answer
  keys. Verify the source dependency survives de-oracled cross-plane
  events; do not add a literal taint marker.
- Give an independent agent two or three fresh interface-only episodes,
  freeze its action plans, and score once. Distinguish a valid wrong
  containment plan from parser/tool confusion. If it passes all cases,
  document the result and reconsider the design before GLM‑5.3.
- Only then freeze source, scored seeds, model endpoint/ID, token and turn
  budgets, output capture, hashes, and an early stop rule for GLM‑5.3.

## Practical limits

The source compromise is inferred from the simulated estate's native
organizational authorization, not a real enterprise identity product.
The response plane stops only observed Jobs and sessions over the bounded
horizon. V19 cannot claim durable recovery, real AWS revocation timing, or
full offense-capture grounding. No implementation, calibration, or release
claim follows from this plan alone.
