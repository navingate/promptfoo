# Cyber Defense CTF Evals — Design

**Date:** 2026-09-04 (v4: 2026-09-06)
**Status:** Draft v4 — approved to proceed to implementation planning. Contract-mechanics
fixes from the third review folded in. **The `DefenseTask` schema is _provisional_: it
freezes only after three vertical slices prove it (§17), not on paper.**
**Owner:** navingate (core@astroware.ai)
**Audience:** promptfoo maintainers; positioning for James / OpenAI-promptfoo cyber story

**Guiding instruction for v0.1:** _do not broaden v0.1 — spend the complexity budget on a
trustworthy verifier._ The bar: for every reported result, a skeptical security engineer
can inspect the verifier evidence and agree the model genuinely succeeded, partially
succeeded, or failed. Eight extremely well-instrumented tasks beat twenty loose ones.

## 1. Problem & motivation

The existing `cyber` plugin (`plugins/cyber/`, branch `plugin-cyber`) measures
**offensive** capability: the model plays the attacker in sandboxed CTF/CVE tasks,
captured flags are scored deterministically, and results are plotted on an
ATT&CK-informed attacker coverage map. James asked for the mirror image: an eval suite
that measures whether a model can **defend** rather than exploit.

**Positioning (not "defensive CTFs"), stated honestly.** This is the defensive half of a
_symmetric cyber-capability framework_. The framework models offensive capability across
observation → analysis → exploitation → persistence, and defensive capability across
observation → investigation → diagnosis → action → verification. **Current releases
measure _subsets_ of that map; coverage expands over the release ladder** — no release
claims complete coverage. Defense is treated as an _experiment with observable
consequences_: the model changes an environment or produces a defensive artifact, an
adversarial condition is tested, legitimate behavior is tested, and the outcome is
measured objectively. SP3's live loop later connects the two halves. The strategic
question: can an AI attack a system, can it defend one, and which is improving faster?

This document designs the defense suite, reusing the offense plugin's manifest→generator
pipeline, sandbox, held-out-split mechanism, and assurance gates.

## 2. Scope decomposition & release ladder

Three sub-projects; this spec designs **SP1 only**. SP1 ships on a release ladder — the
first cut is a _harness-validation_ release, never marketed as a capability benchmark.

| Sub-project | Scope                                                                                       | Status            |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------- |
| **SP1**     | Blue-team task suite — `DefenseTask` contract, scorers, defender coverage map, first corpus | **Designed here** |
| SP2         | Anchor slice — external defensive benchmark through the same runner                         | Roadmap (§12)     |
| SP3         | Live attack–defense loop — a cyber range where offense and defense agents meet              | Roadmap (§12)     |

| Release                       | Target                           | Claim                                                                                               |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| **v0.1 — Harness Validation** | **exactly 8 tasks to start**     | Proves the contract, scorers, sandbox, anti-cheat, promptfoo integration. **No capability claims.** |
| v0.5 — Research Preview       | 30–50 task families + instances  | L2/L3 tasks, held-out variants, first human baselines, category comparisons                         |
| v1.0 — Benchmark              | Broad families + hidden coverage | Investigation, remediation, detection, containment, recovery; baselines; stats                      |

**This spec is v0.1.** **Initial composition — fixed at 8:** Patch & Harden 3 · Sigma
Detection 2 · IOC Investigation 1 · Forensic Triage 2. The three patch tasks must be
**genuinely different vulnerability families**, not variants of one weakness. More tasks
are added only after the contract is proven (§17).

## 3. Decisions (resolved)

- **Base branch — cut from `plugin-cyber`** (it holds the manifest pipeline, sandbox, 29
  targets, split policy). `plugin-defense` currently sits on `main` + the spec commits;
  re-homing is a one-commit rebase at build time (offered, not silent).
- **First batch — 8 tasks**, named "v0.1 Harness Validation."
- **Detection engine — Sigma first** (semantics pinned before authoring, §7B/§20).
- **External anchor — deferred to SP2**; the internal benchmark stands alone.
- **Packaging:** sibling bundle `plugins/cyber-defense/`. **Scoring:** deterministic-
  first; model-graded only as a labeled-key fallback.

## 4. Core principle: two-sided (objective + constraint) defense

Offense has a perfect referee — the flag was captured or it wasn't. Defense has none, and
every defensive task has a lazy answer that looks perfect. The universal rule:

> **A task must independently verify that the intended defensive OBJECTIVE was achieved
> AND that known degenerate / unacceptable solutions are rejected (CONSTRAINT).**

This generalizes the earlier "security AND utility" framing, which was natural for
state-changing defenses but artificial for IOC/forensic tasks (there the two sides are
really recall and precision). The mandatory contract is therefore **`objective_checks` +
`constraint_checks`** (both non-empty), with families exposing their own semantic score
components. **State-changing families (patch, containment, recovery) specialize this to
independent security + utility checks** as a stricter form.

| Family            | Objective (effect achieved) | Constraint (bounded collateral / no cheat)  |
| ----------------- | --------------------------- | ------------------------------------------- |
| Patch             | attack family prevented     | functionality preserved (security+utility)  |
| Detection         | malicious events detected   | benign events tolerated (FPR)               |
| IOC investigation | true indicators recovered   | irrelevant evidence excluded                |
| Triage            | correct incident hypothesis | internally consistent, no unsupported claim |

**Enforced by architecture.** The manifest validator (extending offense
`gen_catalog.py` lifecycle validation) **rejects any task whose `objective_checks` or
`constraint_checks` is empty.** That turns "two-sided" from prose into an invariant.

## 5. The `DefenseTask` contract (provisional — freezes after §17)

Do **not** build `PatchTask`, `DetectionTask`, `ForensicsTask` as independent systems.
One `DefenseTask` contract, all families — the manifest schema for the defense catalog,
the analogue of offense `catalog.manifest.json` → `gen_catalog.py` → Inspect `eval.yml`

- compose + loader. **A schema layered on the existing harness, not a new framework.**
  One lifecycle: `environment → evidence → objective → allowed actions → candidate defense
→ objective verification → constraint/anti-cheat verification → structured result`.

```yaml
# defense.manifest.json entry (conceptual, PROVISIONAL)
DefenseTask:
  id: ; version:
  capability:
    layer: L1|L2|L3|L4
    phases: [observe, investigate, diagnose, act, verify]   # multi-valued
    primary_phase: act                                       # optional, for coverage viz
  environment:            # reused offense target / compose, or a static artifact bundle
  evidence:               # what the model is given (logs, source, symptom)
  objective:              # what a successful defense must achieve
  allowed_actions:        # patch diff | rule text | structured answer | shell (L3+)
  oracle:                 # HOW the answer key is obtained — not necessarily inline
    type: public_reference | held_out | runtime_generated
    ref: ...              # held_out/runtime keys never live in the public manifest
  verifier:
    objective_checks:  [ <check>, ... ]   # MUST be non-empty (validator-enforced)
    constraint_checks: [ <check>, ... ]   # MUST be non-empty (validator-enforced)
    anti_cheat_checks: [ <check>, ... ]
  scoring:
    components: [...]     # family-defined (prevention/preservation | precision/recall | ...)
    gates: {...}
    aggregation: <family-defined>   # security×utility is only the patch default
  taxonomy: { nist_csf: [], d3fend: [], attack: [], cwe: [] }
  contamination: { public: bool, variant_family: id, mutation_class: surface|syntactic|structural }
```

**A `check` is a first-class structure with explicit gate semantics** (checks report
_objective_ failure classes; they do **not** guess _why_ the model failed — the task
scorer derives the final outcome):

```yaml
check:
  id:
  verifier: # executable / reference to run
  expects: # expected outcome
  gate: true|false # a failed required gate means the task CANNOT pass (no averaging away)
  weight: # graded contribution when not a gate
  timeout:
  depends_on: []
  on_failure: security_failure | utility_failure | consistency_failure | anti_cheat_failure | invalid
```

**Result is split** (harness health vs defensive performance; a run can be valid while
the defense partially fails, or invalid regardless of the defense):

```yaml
run_status: valid | invalid | timeout | environment_failure | verifier_failure | policy_block
task_outcome: pass | partial | security_failure | utility_failure | security_and_utility_failure
components: { ... } # raw metrics (incl. detection TP/FP/TN/FN + population) ALWAYS retained
```

`run_status != valid` never counts as a model failure — it is excluded from measurement.

SP3 (live loop) is another **execution mode** of this contract, so it extends rather than
replaces it. **Keep the core narrow:** do _not_ add SP3's temporal-state, concurrency,
partial-containment, recovery, or availability-over-time fields until an SP1 task needs
them.

## 6. Capability layers & phases

| Layer             | Demands                                                                | v0.1?               |
| ----------------- | ---------------------------------------------------------------------- | ------------------- |
| **L1 Knowledge**  | identify a technique, classify an indicator, spot a vulnerable pattern | diagnostic only     |
| **L2 Artifact**   | produce a patch / Sigma rule / IOC set / answer                        | **yes — v0.1 core** |
| L3 Operations     | inspect an environment, discover the cause, act, validate              | v0.5+               |
| L4 Active defense | contain a live/replayed adversary while preserving service             | v1.0 / SP3          |

Every task declares its layer and its (multi-valued) phases; v0.1 is L1–L2. **The suite
must not present L2 artifact generation as agentic (L3/L4) defense.**

## 7. v0.1 categories (all deterministically scored)

**A. Patch & Harden — flagship, L2 (diagnose→act→verify). 3 tasks, different vuln families.**

- **Given:** target source, a functional regression suite, a weakness report (the bug
  _class_, not the exploit). **Produce:** a patch (diff).
- **Objective — an attack _family_, gated:** public reference exploit + ≥1 variant + ≥1
  **held-out** variant (via `split.policy.json`, or runtime-generated). Mutation tiers:
  **surface** (names/ports/timestamps — literal-memorization only), **syntactic**
  (different encoding, near-identical logic — limited), **structural** (vulnerable
  parameter, request path, object relationship, topology, exploit realization —
  **benchmark-quality target**). The held-out variant should differ by _realization_
  (structural), not payload literals. **All critical exploit checks are gates:** 4/5
  blocked with 1 succeeding is not `security = 0.8` — the service is still exploitable, so
  the task cannot pass.
- **Constraint — real regression suite + semantic equivalence, gated on invariants:**
  normal + multiple valid inputs, authorization, negative/boundary inputs, state-changing
  paths. **Verify output/state semantics, not only HTTP status.** Critical functional
  invariants are gates; secondary behaviors contribute graded scores.
- **Anti-cheat / penalized:** removing the endpoint, disabling the feature, blanket-
  erroring input, broad denial, breaking auth → constraint fails.
- **Score:** `overall = prevention × preservation` with the gates above; components always
  shown.

> **Cost, honestly (final walk-back of "free win").** The exploit-fails signal is free;
> the variant family + regression + semantic checks are real per-target authoring.
> **Verify in planning:** inspect 2–3 targets for existing functional tests (likely
> absent → each target needs a variant family + regression suite).

**B. Detection Engineering — L2. v0.1 = directed. 2 tasks.**

- **Given:** a threat description + example events. **Produce:** a Sigma rule.
- **Sigma semantics pinned before authoring** (§20): Sigma version, supported rule
  subset, event schema, field mappings, backend/evaluator, normalization, dedup, corpus-
  split semantics. **Unsupported constructs fail validation — never silently reinterpret.**
  v0.1 may deliberately support a restricted subset.
- **Corpus composition is part of the task**; **retain raw `TP/FP/TN/FN` + population
  sizes** and derive precision/recall/F1/FPR/FNR from them (a score at 2/4 differs
  statistically from the same score at hundreds/thousands). Document prevalence, benign
  source families, near-miss distribution, dedup policy, macro/micro averaging.
- **Generalization** (the detection analogue of the patch family): a technique **template**
  → public examples → transformations → **held-out instances** differing in identity,
  host, command, parent process, path, field presence, source, ordering — behavior
  preserved.
- **Rejects:** match-all (precision collapses); match-none (recall 0). B2 discovery → v0.5.

**C. Telemetry / IOC Investigation — L2. 1 task.**

- **Given:** telemetry with benign noise + decoys. **Produce:** a typed set, with
  **observables separated from findings** — an ATT&CK technique is an _interpretation_,
  not an observable, so it does not share a type system with IPs/hashes/domains:
  ```yaml
  observables: [{ type: ip|domain|url|hash|user|host|file|registry, value }]
  findings: [{ type: attack_technique|compromised_identity|c2_host, value }] # v0.5 scoring
  ```
  **v0.1 scores observables only.** Scoring findings (the observation→conclusion leap) is
  v0.5.
- **Canonicalization is a documented, versioned spec** (§20) — domain case/trailing-dot/
  host-vs-URL/port, IPv6 forms, URL normalization, Windows paths, hash casing, cloud IDs,
  identities. Changing it versions the benchmark.
- **Verifier:** normalize, then precision + recall vs ground truth with decoys; gate on
  both. **Rejects:** dump-everything (precision collapses).

**D. Forensic / Incident Triage — L2. 2 tasks.**

- **Given:** synthetic incident artifacts. **Produce:** answers to **dependent** questions
  (patient-zero → initial access → compromised identity → persistence → blast radius →
  data touched → containment).
- **Containment stays deterministic — no model-judge.** Use a bounded action set ("select
  all appropriate") or a structured answer with task-defined accepted alternatives:
  ```yaml
  containment: { isolate_hosts: [...], disable_accounts: [...], block_indicators: [...] }
  ```
- **Verifier:** exact/set match vs a fixed key with distractors, **plus deterministic
  cross-field consistency checks:** claimed identity reachable from the claimed host;
  persistence on a claimed-compromised host; containment matches blast radius. **Rejects:**
  guessing; internally impossible narratives. Agent-inspects-real-artifacts → v0.5.

## 8. Scoring architecture

- **Universal invariant, family-specific aggregation.** Every task verifies objective +
  constraint; each family maps that into its own components and aggregation. Common
  _interface_ (`components` / `gates` / `aggregation`), family-specific _formula_: Patch →
  prevention × preservation; Detection → precision/recall/F1/FPR/FNR from raw counts; IOC →
  precision + recall post-canonicalization; Triage → correctness + consistency (with
  unsupported-conclusion penalties).
- **Gate semantics:** if a required gate fails, the task cannot pass; otherwise compute
  graded component scores. A critical vulnerability can never be averaged away.
- **Components always visible** even when the overall gates to 0.
- **`run_status` vs `task_outcome` kept separate**; invalid/harness runs never count as
  model failures.
- **Resource cost recorded** (tokens, tool calls, wall-clock), identical budget across
  compared models. Comparative metrics are v0.5+.

## 9. Three kinds of validity (kept separate)

1. **Harness assurance** — did the experiment run correctly? (Gate-0A/0B).
2. **Task validity** — does the task distinguish good from bad defense? (calibration
   fixtures, §18). All must behave before any model runs.
3. **Benchmark validity** — does the suite support capability conclusions? **v0.5+; not
   claimed for v0.1.**

## 10. Taxonomy (coverage/reporting layer, not a scoring ontology)

- **NIST CSF 2.0 — six functions:** Govern, Identify, Protect, Detect, Respond, Recover.
  **Govern intentionally out of scope.** Report: `Govern — not evaluated · Identify —
partial · Protect — evaluated · Detect — evaluated · Respond — evaluated · Recover —
partial`.
- **MITRE D3FEND — optional; blank where no clean mapping** (`d3fend: []`).
- **ATT&CK** (adversary behavior) + **CWE** (weakness) attached where they apply:
  threat→ATT&CK, weakness→CWE, defense→D3FEND, lifecycle→CSF. Coverage-map script mirrors
  offense `build_coverage_map.py`, keyed to `task_defense_map.json`.

## 11. Contamination & hidden evaluation

Everything committed to promptfoo is **public** — no "committed but private" pool. Classes:
**public reference** (docs/repro; low weight), **held-out** (outside the public tree via
`split.policy.json`/`split.py`/`held-out-split.md`; surfaced through `oracle.type:
held_out`), **procedurally varied** (generated at eval time).

**Mutation tiers** (not equally valuable): **surface** (names/ports/timestamps — literal
memorization), **syntactic** (encoding/payload realization, same logic — limited),
**structural** (parameter location, relationships, topology, evidence distribution,
dependency structure — beats _solution-template_ memorization; the benchmark-quality
standard, targeted v0.5+). The per-run nonce protects the _flag_, not the _solution_.

## 12. Roadmap (SP1 v0.5/v1.0 + SP2 + SP3) — not built here

| Track         | Adds                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch levels  | L2 localization → L3 investigation (discover root cause) → L4 active defense                                                                                                                         |
| Detection     | B2 discovery mode; YARA (files) + network detection                                                                                                                                                  |
| Investigation | Category C scores inferred _findings_, not just observables                                                                                                                                          |
| Forensics     | agent inspects a real artifact tree, not a summary                                                                                                                                                   |
| New families  | Identity/Access remediation, Config hardening, Containment, Recovery (fills Identify/Recover)                                                                                                        |
| Rigor         | held-out pools, structural procedural generation, human baselines, benchmark-validity stats                                                                                                          |
| **SP2**       | External anchor only with relevant capability + usable license + reproducible exec + compatible semantics; else defer                                                                                |
| **SP3**       | Cyber range: `Environment ↔ Attacker / Defender → objective verifier`; time-to-detection/containment/remediation, availability. Verifier observes objective state, **not** an LLM judging. User-run. |

## 13. Reuse of offense infrastructure

| Offense component (`plugin-cyber`)                     | Defense use                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `catalog.manifest.json` + `gen_catalog.py`             | `DefenseTask` manifest; extend generator + lifecycle validation (non-empty objective/constraint)   |
| `split.policy.json` / `split.py` / `held-out-split.md` | Held-out variants + detection corpora; backs `oracle.type: held_out`                               |
| `scripts/provider.py`                                  | Defense tasks are Inspect tasks with a defensive scorer                                            |
| Colima VM + `egress-lockdown.sh`                       | Sandbox for code-executing tasks (Category A)                                                      |
| Gate-0A / Gate-0B                                      | Harness-assurance validity (§9.1); per-run nonce, N-attempt, Wilson, controls                      |
| `anti_cheat.py`                                        | Defense equivalent: attack-family, benign-majority, decoys, typed normalization                    |
| 29 targets + reference exploits                        | Category A environments + the objective check's public probe (family + regression = new authoring) |

## 14. Packaging

`plugins/cyber-defense/` sibling bundle; concerns kept **separable** (task definition /
execution / scoring / anti-cheat / taxonomy). Two docs, kept distinct: **`DEFENSE.md`**
(operator guide — setup/run/scope) and **`METHODOLOGY.md`** (benchmark methodology — what
each release measures and does _not_ measure, layers, scoring, hidden evaluation,
contamination, excluded runs, limitations; small in v0.1, grows later).

```
plugins/cyber-defense/
  .claude-plugin/plugin.json  ·  .codex-plugin/plugin.json
  DEFENSE.md  ·  METHODOLOGY.md
  skills/
    cyber-defense-run/        # defense.manifest.json, gen, scorers, provider, deploy
    cyber-defense-taxonomy/   # CSF2.0/D3FEND/ATT&CK/CWE coverage map
```

## 15. Safety / dual-use guardrails

- **No live malware authored or hosted** — technique telemetry (Atomic-Red-Team-style
  logs, not payloads), Sigma test logs, EICAR-class files, synthetic artifacts, already-
  scoped offense exploits. **No adversarial content laundered through an uncensored model.**
- Category A reuses already-scoped offense targets/exploits. Defensive framing throughout.

## 16. Execution constraints

- **SP3 and any real model/agent run are user-run** (auto-mode classifier blocks the
  offense harness, as with `run_0a.sh`). v0.1 authoring + calibration self-tests are
  deterministic and runnable without a model.
- Build on `plugin-cyber` (§3); re-home `plugin-defense` at build time.

## 17. Implementation strategy: three vertical slices → contract freeze

Do **not** build the framework abstractly first. Validate the provisional contract with
three materially different task types, end to end, before freezing it:

1. **Slice 1 — Patch:** one existing target → manifest → generator → Inspect → candidate
   patch → public/structural/held-out exploits → functional regression → structured result
   → promptfoo. Proves sandboxing, patch application, gated attack verification, functional
   preservation.
2. **Slice 2 — Sigma:** a completely different artifact type through the same lifecycle.
   Proves static artifact generation, corpus evaluation, precision/recall from raw counts,
   held-out cases, family-defined scorer.
3. **Slice 3 — Static Investigation/Triage:** a non-container static task through the same
   contract. Proves the abstraction works for a task that does not look like patching.

**Contract-freeze condition:** freeze `DefenseTask`/result v0.1 **only after all three run
through one lifecycle without unnatural schema fields or family-specific hacks in the
core.** If the common generator sprouts family-specific hacks, fix the contract first.
Then author the remaining five tasks.

## 18. v0.1 acceptance criteria & family-specific calibration fixtures

Acceptance: tasks run through the promptfoo/Inspect bridge; sandbox isolated; per-run
nonce works; `run_status != valid` excluded from model scoring; reference runs reproduce;
every task conforms to `DefenseTask` with typed gated `check`s; validator rejects empty
objective/constraint; oracle/held-out material cannot leak into public/generated artifacts.

**Calibration fixtures — universal minimum: every task ships ≥1 positive and ≥1 negative,
and all must behave before any model runs.** Required per family:

| Family    | Required fixtures                                                            |
| --------- | ---------------------------------------------------------------------------- |
| Patch     | no-op · exploit-specific patch · destructive/block-all · correct remediation |
| Detection | match-none · match-all · public-example-overfit · correct general rule       |
| IOC       | empty · dump-all · partially correct · reference-good                        |
| Triage    | incorrect · partially correct · internally inconsistent · reference-good     |

Near-boundary (minimally-flawed) fixtures are encouraged — scoring bugs hide at the
intended partial-credit boundary.

## 19. Non-goals (YAGNI for v0.1)

No live malware. No L3/L4 tasks. No SP3 loop. No SP2 anchor. No Identity/Config/
Containment/Recovery families. No YARA/network detection. No human baselines or benchmark-
validity stats. No model-judge scoring (incl. containment). No full D3FEND/CSF coverage
(Govern out of scope). **Do not broaden v0.1 — spend the budget on the verifier.**

## 20. Planning-phase checklist (before broad task authoring)

Cannot be done from a `main`-based worktree:

1. Re-home `plugin-defense` onto the current `plugin-cyber` tip (eyeball `git log
plugin-cyber -5`; tip `ed1774864`).
2. Inspect the real offense manifest, generator, loader, `eval.yml`, compose, and scorer
   interface — finalize `DefenseTask`/result field names and `check` execution semantics.
3. Inspect 2–3 targets for functional-test coverage (sizes Category A).
4. Implement Slice 1 (Patch) end to end.
5. Implement Slice 2 (Sigma) end to end.
6. Pin Sigma version, evaluator, supported subset, event schema.
7. Implement Slice 3 (static IOC/Triage).
8. Verify the common contract handles all three without artificial fields or core hacks.
9. Finalize `DefenseTask` + result.
10. Confirm oracle/held-out material cannot leak into public/generated artifacts.
11. Freeze the Category-C canonicalization spec.
12. Freeze the Category-B corpus-composition spec.
13. Freeze the v0.1 manifest schema.
14. Author the remaining tasks to reach 8.
15. Run all calibration fixtures before any real model comparison.
