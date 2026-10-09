# Wave 2 + 3 build brief (F10/F7/F8 + F3/F5/F11)

Authored by the design session (F2 Chain) for a dedicated Wave 2+3 **build** session, 2026-10-09.
Counterpart of the Wave 1 build (F9/F6/F4), now merged into `codex/cyber-benchmark-authoring` (tip at
hand-off: `7d6e95809`).

## Goal

Build the smallest faithful implementation of the six **already-designed, G0-reviewed** paired families,
to the same state Wave 1 reached — **do not redesign them**:

| Wave | Family                              | Offense mode       | Defense-twin mode                                  | Needs pinned LLM victim?                |
| ---- | ----------------------------------- | ------------------ | -------------------------------------------------- | --------------------------------------- |
| 2    | F10 Sanctioned-channel exfiltration | offense-capability | defense-detection                                  | no                                      |
| 2    | F7 Cross-tenant support boundary    | offense-capability | tool-conduct                                       | **YES (pinned baseline support agent)** |
| 2    | F8 Recovery-plane sabotage          | offense-capability | incident-response                                  | no                                      |
| 3    | F3 Workload identity cascade        | offense-capability | defense-detection                                  | no                                      |
| 3    | F5 Trusted build, untrusted source  | offense-capability | defense-detection                                  | no                                      |
| 3    | F11 Poisoned incident evidence      | offense-capability | incident-response (+detection reported separately) | **YES (pinned baseline SOC responder)** |

Each family = one shared estate + two separately-scored tasks (offense producer + defense consumer),
reference solutions, recorded evidence for build gates **G0–G5**, then a recorded **local G6** calibration
like Wave 1.

## HARD STOP (identical to Wave 1 — non-negotiable)

- **Stop at G5 + a recorded local G6.** Do **not** run the paid frontier ceiling (the real G6 gate stays
  PENDING) and do **not** do G7 release — hand both back to the user.
- **$0 — always export `CYBER_SUT_ENDPOINT=http://34.21.191.234:8000/v1` explicitly on every run.** The
  general-resolver Azure fallback has **already been removed** by the user's commit `743361b4a` ("remove the
  calibration runner's silent Azure fallback and refuse Azure hosts") — `endpointConfig()` now drops the
  `AZURE_AI_*` fallback and calls `refuseAzureHost()` on the SUT and the victim-loop endpoint. **Do NOT
  re-implement it.** That commit is on `codex/cyber-wave1-build` + `codex/cyber-wave1-f6-calibration` but
  **not yet on `codex/cyber-benchmark-authoring`** — merge design (which will carry it once it lands there;
  F2 Chain is queuing that) into your branch before your first G6. (Hardening idea for later, not yours to
  apply: the guard is a hostname denylist on "azure"; an explicit allowlist of the 34.x box + loopback is
  strictly safer — F2 Chain is relaying it to the user.)
- **Never fabricate** a gate, label, calibration number, telemetry fact, or approval/attestation. Missing =
  recorded PENDING, never invented.
- No `git reset --hard`, no `--no-verify` (a hook rejects it), no amend/squash/rebase unless asked.
- Conventional commits, `(redteam)` scope. **No Claude/Claude-Code attribution** in commits or PRs.

## Base + branch (use a dedicated worktree — do NOT work in the main checkout)

The main checkout carries the Wave 1 build session's branch, cwd and `.claude/flight-plan.md`. Work in your
own worktree so you never collide with it:

```bash
git fetch fork
git worktree add --detach <your-worktree-path> fork/codex/cyber-benchmark-authoring
cd <your-worktree-path> && git switch -c codex/cyber-wave23-build
```

Wave 1 (F9/F6/F4) under `plugins/cyber/benchmarks/` is your **template** — copy its structure/evidence
shape. Read `plugins/cyber/benchmarks/WAVE1-HANDOFF.md` and `WAVE1-VERIFY.md` first. Keep your flight plan in
**your** worktree's `.claude/flight-plan.md`; never edit the main checkout.

## Source of truth (do not redesign)

- Per-family **G0-pending designs already on the branch**: `plugins/cyber/benchmarks/<fam>/FAMILY.md`,
  `offense/`+`defense/` `design.md`/`threat-model.md`/`label-policy.md`/`attack-chain.md`/`validator-contract.md`.
  These passed the independent G0 re-review (near-total PASS, 2026-10-07).
- `.agents/cyber-benchmarks/next-nine-chains.md` (selection/waves) + `design-correction.md` (architecture)
  - `review-policy.md` (AI construct review OK for G0; human required before G7).
- The authoring skill `.agents/skills/cyber-benchmark-authoring/` — `scripts/audit_benchmark.mjs`,
  `audit_telemetry_contract.mjs`, `references/schemas.md`, `references/validation-gates.md`.

## G0 binding — the carry-forward precondition (Wave 1's biggest time-sink)

- G0 is bound as an **author carry-forward of the independent AI construct review** @ `43c437f8c`
  (`openai-codex-gpt-6`, G0 scope, all 18 tasks), per `review-policy.md`. The carry-forward only holds if a
  task's **construct-defining docs are byte-unchanged since `43c437f8c`**.
- **Carry-forward is CLEAN — no re-attestation needed** (corrected 2026-10-09; the earlier "FAMILY.md
  changed" worry was wrong). `git diff 43c437f8c..<design>` over all six family dirs touches **only**
  `offense/review/handoff.md` + `defense/review/handoff.md` (a review-status sentence). **Every
  construct-defining doc is byte-identical to `43c437f8c`**, and the recorded approval covers all 18 tasks.
  So keep `review/handoff.md` OUT of the bind digest (CORE_DOC_RELS = construct docs only) and the
  carry-forward holds byte-identical at your build commit with **no** F6-style re-attestation.
- `CORE_DOC_RELS` = **hand-written construct docs ONLY** (matches the Wave-1 `approval-g0-construct.yml`
  ground truth). **EXCLUDE all generated files** — `observation-plane.yml`, `field-lineage.yml`,
  `forbidden-values.yml` (generate-evidence rewrites them; they changed at F4's bind, so they can't be in a
  byte-identical carry-forward digest). The sets, matching Wave 1 exactly:
  - **offense (all 6):** {design, threat-model, attack-chain, validator-contract, shortcut-audit, FAMILY}
  - **F10/F3/F5 defense:** {design, threat-model, label-policy, scoring-contract, FAMILY}
  - **F7 defense:** {design, threat-model, authorization-policy, tool-boundaries.yml, scoring-contract, FAMILY}
  - **F8/F11 defense:** {design, threat-model, incident-state, response-policy, scoring-contract, FAMILY}
    Add a test asserting every non-generated doc is either digested or on a named exclusion list
    (`review/handoff.md`) — closing the Wave-1 `attack-chain.md`-omission class (`f1ccce8b3`).
- **Exception: F10 takes a FRESH G0 construct review, not the carry-forward.** Its construct is being updated
  (2026-10-09 aggregate-key fix: per-destination key + multi-identity + protected-sensitivity volume unit +
  window — F2 Chain is pushing the doc edits), so F10's construct docs no longer match `43c437f8c`. The other
  five families (F7/F8/F3/F5/F11) keep the clean carry-forward.

## Winnability gate (a G2/G3 check — learned the hard way from F6 v2)

F6 v2's offense turned out **unwinnable by construction**: its only real out-of-scope success target was a
per-run hidden id the attacker is never shown and cannot discover, so under a correct predicate 0/23
"successes" were real. Every induced-effect family MUST pass this gate before G2/G3:

- **Success must be achievable from the ATTACKER-VISIBLE plane.** A reference solver limited to exactly what
  the attacker can see must be able to win; the real success target must be **discoverable** (from read-path
  material / a listed inventory), never only an undiscoverable hidden id. The per-run nonce/marker may be
  hidden **for isolation**, but it must not be the thing the attacker has to hit.
- **A no-discovery / enumerate-everything shortcut must FAIL** (it must not be a cheap win), and an
  invented / non-existent target must not count.
- These Wave 2/3 families already read OK on this (F7/F11 key success to a discoverable action or an
  injected-vs-clean response delta; F10 makes its policy explicitly discoverable; F5 to a signed artifact) —
  **confirm it per family, don't assume.** If a family's only real success target is undiscoverable, that is
  a **design defect → STOP and report to F2 Chain**, do not build around it.

## Per-family construct guardrails from the G0 review (do NOT regress)

- **No answer-like / oracle model-visible fields.** The review already removed three (F10
  `purpose_scope_consistency`, F3 `delegation_without_direct_authority`, F5 `artifact.provenance_sound`).
  Keep derived decision signals evaluator-only; never leak the label/decision into model-visible data.
- **Clean-twin / causal attribution** where a family scores an induced effect (F10/F5/F11 especially): every
  scored success needs a matched clean twin that does NOT trigger the effect — mirror F6's
  `checkCleanTwinInvariant` (target/OOS class ≠ the in-scope class; assert it per seed).
- **F5:** `source_provenance` shorthand is already removed from the construct docs — keep it out.
- **F8:** the release claim stays **stage-conditioned** (restoration measured only in recoverable states).
- **F7 + F11 need a PINNED prose-reading LLM victim** (support agent / SOC responder). That pin is a
  **user/governance hand-back** (choosing+freezing it is benchmark-defining; re-pinning invalidates prior
  offense scores), exactly like F6. **Surface it to the user via F2 Chain up front** — F6's pin blocked G1
  for ~a day. The F6 pin (`palmfuture/Qwen3.6-35B-A3B-GPTQ-Int4` @ the 34.x box) is a reasonable reuse
  candidate for the same prose-reading-victim role, but the user confirms. A local stand-in is a **floor
  probe only** and does not flip G1.
- **Reviewer G1/G2 checkpoints** (step 9b): victim-baseline identity recorded; injected vs clean run in a
  fresh isolated state; a repeated-trial stability protocol declared **before** calibration.

## Shared-tooling discipline (how we avoid merge collisions)

Multiple sessions touch these — treat as **append-only**:

- `plugins/cyber/benchmarks/_tooling/calibration-runner.mjs` — add new per-family/per-mode modes (as F6
  added `--pinned-g1`); **do not rewrite** the existing F9/F4/F6 `--record`/floor-probe/pinned paths. Build
  may still touch this for deferred frontier-G6 work — **coordinate via F2 Chain before editing it**.
- `.agents/cyber-benchmarks/suite.yml` is **generated** — never hand-edit `benchmarks[]`. After you bind a
  task: `node .agents/skills/cyber-benchmark-authoring/scripts/build_suite_registry.mjs --repo-root .` then
  `... --check` (exits nonzero if stale); commit the regenerated `suite.yml` with the bind. **Register both
  sides of a family together** — the auditor raises `PAIR_NOT_RECIPROCAL` if a twin's record is absent.
- **Merge design into your branch before each push** (MERGE, not rebase). Keep each family's offense+defense
  on **one** `implementation.commit` (reciprocity + commit-matched local G6).
- Keep the `_tooling` selftest and `wave1-regression.test.mjs` green; add Wave 2/3 cases alongside Wave 1's.

## Build-time construct defects: STOP and report, do not patch

"Do not redesign" does **not** mean "don't report". Wave 1 surfaced three genuine construct defects only at
build time (e.g. F6 seed-53 clean-twin collision). If you hit one: **stop that gate, write up the defect,
and send it to F2 Chain** (construct owner). Never patch a construct doc unilaterally — that breaks the G0
carry-forward and the review chain.

## Verify-before-done (mirror WAVE1-VERIFY.md)

Per task at its bind commit: `audit_benchmark.mjs --repo-root . --task <t> --commit <C> --suite
.agents/cyber-benchmarks/suite.yml` → only `MODE_GATE_REQUIRED` on intended pending gates, nothing else;
`audit_telemetry_contract.mjs` → `PASS: 0`; registry `--check` current; selftest + regression green.

## Landing + routing

- Open a **PR into `codex/cyber-benchmark-authoring`** (like Wave 1's PR #10/#11); scope each PR to one wave
  or one family-pair so review stays tractable. **Do not self-merge** — the auto-mode classifier blocks
  merge-without-review; the **user merges** after review.
- **Route to F2 Chain** (`SendMessage`, name `F2 Chain`): every construct question, reference-injection
  legitimacy sign-off, gate-mechanics ruling, scope/decidability call, and any shared-runner edit. F2 Chain
  holds the construct authority and the suite registry. (Wave 2/3 needs no G0 re-attestation — carry-forward
  is clean.)
- **Route to the user:** the F7/F11 victim pins, the frontier-G6 go, and G7.
