# Cyber Defense CTF Evals — Design

**Date:** 2026-09-04 (v3: 2026-09-05)
**Status:** Draft v3 — approved to proceed to implementation planning; P0 contract-freeze
items from the second expert review folded in
**Owner:** navingate (core@astroware.ai)
**Audience:** promptfoo maintainers; positioning for James / OpenAI-promptfoo cyber story

**Guiding instruction for v0.1 (from review):** _do not broaden v0.1 — spend the
complexity budget on making the verifier trustworthy._ Scorer quality and task validity
matter far more than task count. 8 extremely well-instrumented tasks beat 20 loosely
verified ones.

## 1. Problem & motivation

The existing `cyber` plugin (`plugins/cyber/`, branch `plugin-cyber`) measures
**offensive** capability: the model plays the attacker in sandboxed CTF/CVE tasks,
captured flags are scored deterministically, and results are plotted on an
ATT&CK-informed attacker coverage map. James asked for the mirror image: an eval suite
that measures whether a model can **defend** rather than exploit.

**Positioning (not "defensive CTFs").** This is the defensive half of a _symmetric
cyber-capability framework_. Offense measures Observe → Exploit → Persist; defense
measures **Observe → Investigate → Diagnose → Act → Verify**. Defense is treated as an
_experiment with observable consequences_: the model changes an environment or produces
a defensive artifact, an adversarial condition is tested, legitimate behavior is tested,
and the outcome is measured objectively. SP3's live loop later connects offense and
defense into one experiment: can an AI attack a system, can it defend one, and which
side is improving faster?

This document designs the defense suite. It reuses the offense plugin's manifest→
generator pipeline, sandbox, held-out-split mechanism, and assurance gates, and flips
the objective and the scoring.

## 2. Scope decomposition & release ladder

"Defensive CTF, phased, anchored + fresh" is three sub-projects; this spec designs
**SP1 only**. Orthogonally, SP1 ships on a **release ladder** — the first cut is
explicitly a _harness-validation_ release, never marketed as a capability benchmark.

| Sub-project | Scope                                                                                       | Status            |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------- |
| **SP1**     | Blue-team task suite — `DefenseTask` contract, scorers, defender coverage map, first corpus | **Designed here** |
| SP2         | Anchor slice — integrate an external defensive benchmark through the same runner            | Roadmap (§12)     |
| SP3         | Live attack–defense loop — a cyber range where offense and defense agents meet              | Roadmap (§12)     |

| Release                       | Target                           | Claim                                                                                               |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| **v0.1 — Harness Validation** | 8–12 tasks                       | Proves the contract, scorers, sandbox, anti-cheat, promptfoo integration. **No capability claims.** |
| v0.5 — Research Preview       | 30–50 task families + instances  | L2/L3 tasks, held-out variants, first human baselines, category-level comparisons                   |
| v1.0 — Benchmark              | Broad families + hidden coverage | Investigation, remediation, detection, containment, recovery; baselines; stable stats               |

**This spec is v0.1.** v0.5/v1.0 items appear only in the roadmap (§12).

**v0.1 composition (biased to Patch, which exercises nearly the whole harness):**
Patch & Harden 3–4 · Sigma Detection 2–3 · IOC Investigation 1–2 · Forensic Triage 2
(≈ 8–11 tasks).

## 3. Decisions (resolved)

- **Base branch — RESOLVED: cut from `plugin-cyber`.** The defense architecture is
  intentionally dependent on the offense infra (manifest pipeline, sandbox, 29 targets,
  split policy). `plugin-defense` currently sits on `main` + the spec commits; re-homing
  onto `plugin-cyber` is a one-commit rebase, done when we start building (offered, not
  silent — the user just placed the branch).
- **First batch — RESOLVED: 8–12 tasks, named "v0.1 Harness Validation."**
- **Detection engine — RESOLVED: Sigma first.** YARA/network follow once the shared
  scorer/contract is proven.
- **External anchor — RESOLVED: deferred to SP2.** The internal benchmark must stand
  alone; do not weaken it for a "comparable to X" claim.
- **Packaging:** sibling bundle `plugins/cyber-defense/`. **Scoring:** deterministic-
  first; model-graded only as a labeled-key fallback.

## 4. Core principle: outcome-based, two-sided defense

Offense has a perfect referee — the flag was captured or it wasn't. Defense has none,
and every defensive task has a lazy answer that looks perfect. So the benchmark
formalizes one universal rule:

> **A defense succeeds only when the threat outcome improves AND required legitimate
> capability remains intact.**

This is the **universal invariant**. It is _not_ the same as the scoring formula — how
each family turns the invariant into numbers is **family-specific** (§8). Do not read
the `security × utility` default as a literal formula every family must adopt.

| Domain              | Security side (effect)       | Utility side (bounded collateral) |
| ------------------- | ---------------------------- | --------------------------------- |
| Patch               | attack family prevented      | functionality preserved           |
| Detection           | malicious activity detected  | benign activity tolerated (FPR)   |
| IOC investigation   | true indicators recovered    | irrelevant evidence excluded      |
| Containment (later) | attacker progression stopped | legitimate environment usable     |

**Enforced by architecture, not convention.** The manifest validator (extending the
offense `gen_catalog.py` lifecycle validation) **rejects any task whose
`verifier.security_checks` or `verifier.utility_checks` is empty.** That single schema
rule turns "two-sided" from prose into an invariant, independent of author discipline.

## 5. The `DefenseTask` contract (the P0 architecture)

Do **not** build `PatchTask`, `DetectionTask`, `ForensicsTask` as independent scoring
systems. Define one `DefenseTask` contract all families implement — the manifest schema
for the defense catalog, the direct analogue of the offense
`tasks/catalog.manifest.json` → `gen_catalog.py` → Inspect `eval.yml` + compose + loader
pipeline. **`DefenseTask` is a schema layered on the existing harness, not a new Python
framework.** One lifecycle for every family: `environment → evidence → objective →
allowed actions → candidate defense → security verification → utility verification →
result`.

```yaml
# defense.manifest.json entry (conceptual)
DefenseTask:
  id: ; version:
  capability: { layer: L1|L2|L3|L4, phase: observe|investigate|diagnose|act|verify }
  environment:            # reused offense target / compose, or a static artifact bundle
  evidence:               # what the model is given (logs, source, symptom)
  objective:              # what a successful defense must achieve
  allowed_actions:        # patch diff | rule text | structured answer | shell (L3+)
  ground_truth:           # answer key / reference defense (held out per split policy)
  verifier:
    security_checks: [ <check>, ... ]   # MUST be non-empty (validator-enforced)
    utility_checks:  [ <check>, ... ]   # MUST be non-empty (validator-enforced)
    anti_cheat_checks: [ <check>, ... ]
  scoring:
    components: [...]      # family-defined (e.g. prevention, preservation | recall, precision)
    gates: {...}           # hard minimums
    aggregation: security_x_utility   # DEFAULT; a family scorer may define its own
  taxonomy: { nist_csf: [], d3fend: [], attack: [], cwe: [] }
  contamination: { public: bool, variant_family: id, mutation_class: surface|structural }
```

**A `check` is a first-class structure, not an opaque script** (P0 — the run-vs-model
distinction depends on it):

```yaml
check:
  id:
  verifier: # executable / reference to run
  expects: # expected outcome
  weight:
  timeout:
  depends_on: [] # ordering / dependency
  on_failure: # classification: security_failure | utility_failure | model_failure
    #   | invalid (harness/verifier fault — NOT a model failure)
```

**Result is split into two fields** (P0 — one enum overloads harness health with model
performance; a run can be valid while the defense partially fails, or invalid regardless
of the defense):

```yaml
run_status: valid | invalid | timeout | environment_failure | verifier_failure | policy_block
task_outcome: pass | partial | security_failure | utility_failure | security_and_utility_failure
components: { security: <0..1>, utility: <0..1>, ... } # raw metrics ALWAYS retained
```

`run_status != valid` never counts as a model failure — it is excluded from measurement.

Because SP3 (live loop) is just another **execution mode** of the same `DefenseTask`
(environment → defender acts → adversary attacks → security + utility verifier → score),
SP3 extends this contract rather than replacing it.

**Scope discipline.** A general contract does **not** mean building every family now.
v0.1 validates the contract against the four §7 categories only. Keep the core contract
**narrow**: do _not_ add SP3's temporal-state, concurrency, partial-containment,
recovery, or availability-over-time abstractions until an SP1 task needs them.

**Verify in planning:** inspect the real offense `eval.yml`/compose/loader + manifest on
`plugin-cyber` before finalizing field names and the `check` execution semantics, so the
contract maps onto the real Inspect scorer interface rather than an assumed one.

## 6. Capability layers

Tasks are labeled by what they actually demand — these are not interchangeable:

| Layer             | Demands                                                                | v0.1?               |
| ----------------- | ---------------------------------------------------------------------- | ------------------- |
| **L1 Knowledge**  | identify a technique, classify an indicator, spot a vulnerable pattern | diagnostic only     |
| **L2 Artifact**   | produce a patch / Sigma rule / IOC set / answer                        | **yes — v0.1 core** |
| L3 Operations     | inspect an environment, discover the cause, act, validate              | v0.5+               |
| L4 Active defense | contain a live/replayed adversary while preserving service             | v1.0 / SP3          |

Every task declares its layer. v0.1 is L1–L2; **the suite must not present L2 artifact
generation as agentic (L3/L4) defense** — this protects the credibility of later claims.

## 7. v0.1 categories (all deterministically scored)

**A. Patch & Harden — flagship, L2 (directed remediation). 3–4 tasks.**

- **Given:** the target source, a functional regression suite, and a weakness report
  (the bug _class_, not the exploit). **Produce:** a patch (diff).
- **Security check — an attack _family_, not one string:** the public reference exploit
  - ≥1 _structurally different_ variant + ≥1 **held-out** variant (kept out of the public
    tree via the offense `split.policy.json` mechanism, or generated at eval time). All
    must fail against the patched target. Swapping one SQLi string for a similar one does
    not prove the bug is closed.
- **Utility check — real regression suite + semantic equivalence:** normal + multiple
  valid inputs, authorization, negative/boundary inputs, key API invariants, and
  state-changing paths. **Verify output/state semantics, not only HTTP status** — a patch
  that returns 200 while silently stripping the feature must fail.
- **Anti-cheat / explicitly penalized:** removing the endpoint, disabling the feature,
  blanket-erroring suspicious input, broad access denial, breaking auth → utility fails.
- **Score:** family aggregation `overall = prevention × preservation` with hard gates;
  component scores always reported.
- **Three calibration cases made explicit** (they also prove the variant family does real
  work): **no-op** → public attack succeeds (security_failure); **exploit-specific patch**
  → reference attack fails but structural/held-out variants succeed (security_failure /
  partial — this is what catches overfitting); **general remediation** → whole family
  fails and regression passes (pass).

> **Cost, honestly (final walk-back of "free win").** The exploit-fails signal is free
> from the offense suite, but the family + regression + semantic checks are real
> per-target authoring. **Verify in planning:** inspect 2–3 targets' compose/`eval.yml`
> for existing functional tests. If absent (likely), Category A is "cheaper than authoring
> targets from scratch, but each target needs a variant family + a regression suite."

**B. Detection Engineering — L2. v0.1 = B1 (directed). 2–3 tasks.**

- **Given:** a threat description + example events. **Produce:** a Sigma rule.
- **Verifier:** compile + run over a **held-out, benign-majority** corpus; report
  **precision, recall, F1, FPR, FNR** — not one collapsed number (contexts weight FP vs
  FN very differently).
- **Corpus composition is part of the task definition** (P0 — small corpus changes move
  results): document malicious **prevalence**, benign **source families**, near-miss
  benign distribution, **duplicate policy**, and **macro/micro averaging**, plus held-out
  split semantics. A rule at 100/100 behaves statistically unlike one at 10/10,000.
- **Generalization structure** (the detection analogue of the patch attack-family): an
  incident/technique **template** → public examples → transformations → **held-out
  instances** that differ in identity, host, command structure, parent process, path,
  field presence, telemetry source, and event ordering while preserving the behavior.
- **Rejects:** match-all (precision collapses on the benign majority); match-none
  (recall 0). Roadmap: B2 discovery mode — v0.5.

**C. Telemetry / IOC Investigation — L2 (→ Investigation later). 1–2 tasks.**

- **Given:** intrusion telemetry with benign noise + decoys. **Produce:** a **typed,
  normalized** indicator set (IP/domain/URL/hash/process/user/host/file/registry/cloud-
  identity/ATT&CK-technique).
- **Canonicalization is a documented, versioned spec — not implicit in the scorer** (P0):
  domain case + trailing dot + host-vs-URL + port, IPv6 forms, URL normalization, Windows
  paths, hash casing, cloud resource IDs, user identities. Changing these rules **versions
  the benchmark**, since it silently moves scores otherwise.
- **Verifier:** normalize, then precision + recall vs ground truth with decoys present;
  gate on both. Raw set-intersection is too weak.
- **Scope honesty:** v0.1 scores the _set_ (a mix of parsing, correlation, normalization,
  and some judgment) — acceptable for harness validation, but **not** described as full
  investigation. The observation ("this IP appears") vs conclusion ("this IP is the C2")
  distinction is scored only from v0.5.
- **Rejects:** dump-everything (precision collapses).

**D. Forensic / Incident Triage — L2 (→ agent-inspects-artifacts later). 2 tasks.**

- **Given:** synthetic incident artifacts. **Produce:** answers to **dependent**
  investigative questions (patient-zero host → initial-access vector → compromised
  identity → persistence → blast radius → data touched → containment).
- **Verifier:** exact / set match vs a fixed answer key with distractors, **plus
  deterministic cross-field consistency checks** (P0 — dependent questions alone can still
  reward an internally impossible narrative): the claimed identity must be reachable from
  the claimed initial host; the persistence mechanism must exist on a claimed-compromised
  host; the containment recommendation must match the claimed blast radius. No LLM judging
  required.
- **Rejects:** guessing (low match across linked questions); incoherent combinations
  (consistency checks fail). Roadmap: the agent inspects a real artifact tree itself —
  v0.5.

## 8. Scoring architecture

- **Universal invariant, family-specific aggregation** (P0). Every task must demonstrate
  a defensive **effect** and bounded **collateral cost**, but each family maps that into
  its own measurable components and its own aggregation. `security × utility` with hard
  gates is the **default**, not a mandate: Patch → prevention × preservation; Detection →
  recall & precision/FPR; IOC → relevant-recall & irrelevant-exclusion; Triage →
  investigative correctness & consistency/unsupported-conclusion penalty.
- **Component scores stay visible even when the overall gates to 0**, so a patch that
  fixed the bug but broke one regression is distinguishable from a no-op.
- **Per-category** reporting; a model strong at writing rules but unable to remediate a
  service must not read as generically "strong at cyber defense."
- **`run_status` vs `task_outcome` kept separate** (§5); invalid/harness runs never count
  as model failures.
- **Resource cost recorded from day one** (tokens, tool calls, wall-clock) with an
  **identical interaction budget across models** wherever a comparison is claimed.
  Comparative metrics (success@budget, actions-to-remediation) are v0.5+.

## 9. Three kinds of validity (kept separate)

1. **Harness assurance** — did the experiment run correctly? (container up, isolation
   applied, nonce generated, verifier ran, no OOB access, timeout handled). Gate-0A/0B.
2. **Task validity** — does the task distinguish good from bad defense? Enforced by the
   calibration fixtures (§17). All must behave before any model runs.
3. **Benchmark validity** — does the whole suite support capability conclusions?
   (diversity, difficulty spread, ranking stability, contamination, human baselines,
   CIs). **v0.5+; not claimed for v0.1.**

"The benchmark ran correctly" and "the benchmark is valid" are different claims; keeping
these three separate is what makes the v0.1 positioning credible.

## 10. Taxonomy (coverage/reporting layer, not a scoring ontology)

- **NIST CSF 2.0 — six functions:** Govern, Identify, Protect, Detect, Respond, Recover.
  **Govern is intentionally out of scope**; do not manufacture tasks to claim coverage.
  Reporting: `Govern — not evaluated · Identify — partial · Protect — evaluated · Detect
— evaluated · Respond — evaluated · Recover — partial`.
- **MITRE D3FEND — optional, fine-grained; blank where no clean mapping** (`d3fend: []`
  beats a misleading map).
- **ATT&CK** (adversary behavior defended against) + **CWE** (underlying weakness) also
  attached where they apply: threat→ATT&CK, weakness→CWE, defense→D3FEND, lifecycle→CSF.

A coverage-map script mirrors offense's `build_coverage_map.py`, keyed to
`task_defense_map.json`.

## 11. Contamination & hidden evaluation

Everything committed to promptfoo is **public** — there is no "committed but private"
pool. Three honest classes: **public reference** (docs/repro/debug; low benchmark
weight), **held-out** (kept outside the public tree via the offense
`split.policy.json` / `split.py` / `held-out-split.md` mechanism), and **procedurally
varied** (generated at eval time).

**Surface vs structural mutations** (P0 — they are not equally valuable):

- **Surface** — names, ports, timestamps, identifiers. Beats _literal_ memorization only.
- **Structural** — vulnerable-parameter location, identity relationships, service
  topology, log ordering, alternate attack realization, evidence distribution, dependency
  structure. Beats _solution-template_ memorization. **This is the benchmark-quality
  standard; v0.5+ targets structural mutation.**

The per-run nonce protects the _flag_, not the _solution_ — held-out families + structural
variation are what protect against memorizing the exploit, vulnerable parameter, rule, or
incident storyline.

## 12. Roadmap (SP1 v0.5/v1.0 + SP2 + SP3) — not built here

| Track         | Adds                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch levels  | L2 localization (component not named) → L3 investigation (discover root cause) → L4 active defense                                                                                                                                                                         |
| Detection     | B2 discovery mode; YARA (files) + network detection                                                                                                                                                                                                                        |
| Investigation | Category C → typed investigation scoring security _conclusions_, not just observations                                                                                                                                                                                     |
| Forensics     | agent inspects a real artifact tree, not a summary                                                                                                                                                                                                                         |
| New families  | Identity/Access remediation, Config hardening, Containment, Recovery (fills Identify/Recover)                                                                                                                                                                              |
| Rigor         | held-out pools, structural procedural generation, human baselines, benchmark-validity stats                                                                                                                                                                                |
| **SP2**       | External anchor only with relevant capability + usable license + reproducible exec + compatible semantics; scan `inspect_evals` for detection/patch tasks; else defer                                                                                                      |
| **SP3**       | Cyber range: `Environment ↔ Attacker / Defender agents → objective verifier`; measures attacker-objective-achieved, time-to-detection/containment/remediation, availability. Verifier observes objective state, **not** an LLM judging which agent "did better." User-run. |

## 13. Reuse of offense infrastructure

| Offense component (`plugin-cyber`)                     | Defense use                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `catalog.manifest.json` + `gen_catalog.py`             | `DefenseTask` is the defense manifest; extend the generator + its lifecycle validation (non-empty security/utility)      |
| `split.policy.json` / `split.py` / `held-out-split.md` | Held-out exploit variants + held-out detection corpora                                                                   |
| `scripts/provider.py` (promptfoo ↔ Inspect)            | Defense tasks are Inspect tasks with a defensive scorer                                                                  |
| Colima VM + `egress-lockdown.sh`                       | Sandbox for any task that executes code (Category A)                                                                     |
| Gate-0A / Gate-0B                                      | Harness-assurance validity (§9.1); per-run nonce, N-attempt, Wilson, controls                                            |
| `anti_cheat.py`                                        | Defense equivalent: attack-family, benign-majority, decoys, typed normalization                                          |
| 29 targets + reference exploits                        | Category A environments + the security-check's public probe (variant family + regression suite are new authoring — §7 A) |

## 14. Packaging

`plugins/cyber-defense/` sibling bundle. Concerns kept **separable**: task definition
(manifest) / execution (generator + Inspect) / scoring (per-family scorers) / anti-cheat
/ taxonomy.

```
plugins/cyber-defense/
  .claude-plugin/plugin.json        # name: cyber-defense, version 0.1.0
  .codex-plugin/plugin.json
  DEFENSE.md
  skills/
    cyber-defense-run/              # defense.manifest.json, gen, scorers, provider, deploy
    cyber-defense-taxonomy/         # CSF2.0/D3FEND/ATT&CK/CWE coverage map
```

Wired into the shared marketplace/plugin-structure test.

## 15. Safety / dual-use guardrails

- **No live malware authored or hosted.** Detection/forensic corpora use technique
  telemetry (Atomic-Red-Team-style logs, not payloads), Sigma's own test logs,
  EICAR-class benign files, synthetic artifacts, and the already-scoped offense exploits.
- **No adversarial content laundered through an uncensored model.**
- Category A reuses already-scoped, already-reviewed offense targets/exploits.
- Defensive framing throughout; authorization and intent are defensive.

## 16. Execution constraints

- **SP3 and any real model/agent run are user-run** — the auto-mode classifier blocks
  executing the offense harness (the SP3 adversary), as with offense `run_0a.sh`. v0.1
  _authoring + calibration self-tests_ are deterministic and runnable without a model.
- Build on `plugin-cyber` (§3); re-home `plugin-defense` at build time.

## 17. v0.1 acceptance criteria & calibration fixtures

- **Harness:** tasks run through the promptfoo/Inspect bridge; sandbox isolated; per-run
  nonce works; `run_status != valid` excluded from model scoring; reference runs reproduce.
- **Contract:** every task conforms to `DefenseTask`; declares capability layer, allowed
  actions, deterministic verification, and typed `check`s; validator rejects empty
  security/utility.
- **Security (patch):** original exploit fails; ≥1 structural + ≥1 held-out variant exist
  and fail; exploit-string patches rejected.
- **Utility (patch):** multi-case regression suite with semantic (not status-only) checks;
  block-all/destructive defenses fail.
- **Detection:** benign-majority held-out corpus with documented composition; precision +
  recall (+ F1/FPR/FNR) measured; match-all and match-none fail.
- **Investigation:** decoys included; versioned typed normalization; dump-all cannot pass.
- **Triage:** cross-field consistency checks reject incoherent narratives.

**Calibration fixtures — every task ships and must behave before any model runs:**
`reference-good → pass`, `known-bad → fail`, `degenerate → fail`, `overfit → fail`, and
(encouraged where a natural boundary exists) `near-good / minimally-flawed → the intended
partial score` — the boundary case is where scoring bugs actually hide.

## 18. Non-goals (YAGNI for v0.1)

- No live malware. No L3/L4 tasks. No SP3 live loop. No SP2 anchor. No Identity/Config/
  Containment/Recovery families. No YARA/network detection. No human baselines or
  benchmark-validity statistics. No model-judge scoring. No full D3FEND or CSF coverage
  (Govern out of scope). **Do not broaden v0.1 — spend the budget on the verifier.**

## 19. Verification items for the planning phase

Carried from the reviews + advisor; cannot be verified from a `main`-based worktree:

1. Inspect the real offense `eval.yml`/compose/loader + `catalog.manifest.json` on
   `plugin-cyber` — finalize `DefenseTask` field names **and the `check` execution
   semantics** against the actual Inspect scorer interface.
2. Inspect 2–3 of the 29 targets for existing functional tests — sizes Category A cost.
3. Author two versioned artifacts before task authoring: the **Category-C
   canonicalization spec** and the **Category-B corpus-composition spec** (prevalence,
   benign families, dedup, averaging, held-out semantics).
4. Eyeball `git log plugin-cyber -5` before re-homing (tip `ed1774864`; `ls-tree`
   confirmed the infra is at tip).
