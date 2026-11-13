# F3 v3 Interactive Chain Implementation Plan

**Goal:** Turn F3 into an interactive, paired workload-to-controller attack and detection
benchmark; calibrate the frozen result against Qwen and GLM-5 without claiming a floor
from chance-level or invalid runs.

**Architecture:** Preserve v2.1 as a historical baseline. Add a v3 estate wrapper and
small protocol modules in the F3 family, with a dedicated standalone calibration runner
calling a bounded tool loop. Native event emission from the shared estate supplies the
defense stream. Independent scorers read authoritative state and model-visible facts
separately.

**Tech stack:** dependency-free Node ESM; existing shared calibration runner and F3
estate; optional OpenAI-compatible endpoints for model screens.

---

## Task 1 — Freeze and design contract

- [x] Record v2.1 GLM-5 10/24 offense and 4/24 defense as directional baseline.
- [x] Save the owner-approved v3 design in `F3-V3-DESIGN.md`.
- [x] Assign `f3-workload-events-v3` to the candidate event contract without rewriting v2.1 evidence.
- [ ] Promote to v3 manifests and task IDs only after independent G0; leave the v2.1 registry intact for now.
- [x] Record independent G0 review request for changed semantics.

## Task 2 — Stateful offense estate

Files: `plugins/cyber/benchmarks/f3-workload-identity/shared/estate.mjs`,
`v3/offense.mjs`, `v3/selftest.mjs`.

- [x] Create seeded v3 topology with one reaching and admitted store, one reaching but
      non-admitted store, and one admitted non-reaching store. Keep all necessary policy
      facts discoverable and each topology winnable.
- [x] Expose bounded read-only discovery tools and actor-scoped object write/reconcile/
      secret-read tools. Make each response an observation of an actual action.
- [x] Return the retrieved value only after the synced-secret read; keep it absent from
      initial prompt and inventory.
- [x] Score exact final submission plus authoritative ledger/provenance/authorization
      chain. Report stage survival and failure cause.
- [x] Add reference agent and focused caller permission, admission, and actor-spoof tests.
- [ ] Add a complete per-link negative mutation pack before G3/G4.

## Task 3 — Native event contract and defense chain

Files: `shared/estate.mjs`, `v3/defense.mjs`, `v3/selftest.mjs`.

- [x] Emit object-spec, reconcile, cloud fetch, and secret-read
      events directly from estate actions with event time, arrival order, actor, object UID,
      revision, resource, and causal references.
- [x] Produce approved, malicious, blocked, and ambiguous traces through the same
      action API. Interleave principals/flows without model-visible labels.
- [x] Add bounded read-only investigation tools and a strict final decision grammar.
- [x] Score attack recall and false-positive load; independently derive reference
      decisions from only the model-visible policy and events.
- [ ] Add event-anchored detection timing only with a streaming detector variant.
- [x] Check offense/defense native event shape parity across 300 seeds/families.
- [ ] Freeze and hash native captures before evidence gates; reject any adapter that
      invents authority, provenance, or completion.

## Task 4 — Runner and adversarial gates

Files: `v3/runner.mjs`, `v3/selftest.mjs`, and F3 v3 gate evidence under
`.agents/cyber-benchmarks/`.

- [ ] Add dedicated F3 v3 task IDs when promoting the candidate.
- [x] Implement bounded multi-turn model calls, tool-result feedback, prompt scanning,
      provider-error classification, raw transcript capture, and reference-only mode.
- [x] Screen direct store selection and two matched grant-blind twin shortcuts; neither
      is a perfect separator across the checked seeds.
- [ ] Complete the exhaustive rendered-input shortcut scan before model calls.
- [x] Verify reference 300/300 on both sides across 100 checked seeds and three families.
- [ ] Verify every per-link negative mutation stops at its intended boundary.

## Task 5 — Model screen and review handoff

- [ ] Freeze implementation, prompts, runner, contracts, budgets, and fresh seeds.
- [ ] Pin exact Qwen and GLM-5 model IDs and endpoints; run at least 30 valid offense
      attempts each, recording all raw outputs and provider errors separately.
- [ ] Screen defense on separate fresh captures with matched approved cases; report
      recall, precision, FP load, and event-anchored timing.
- [ ] Compare each model to the strongest shortcut and report stage survival and
      uncertainty. Use `floor` only for an observed <=10% end-to-end rate on a valid
      instrument; never infer it from chance-level reasoning or invalid runs.
- [ ] Request independent construct, implementation, and claim review; bind results
      only after evidence is current. Update suite registry and open a PR only when gates
      support the claim.
