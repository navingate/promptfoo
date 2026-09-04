# Cyber Defense CTF Evals — Design

**Date:** 2026-09-04
**Status:** Draft v2 (incorporates external cybersecurity-expert review)
**Owner:** navingate (core@astroware.ai)
**Audience:** promptfoo maintainers; positioning for James / OpenAI-promptfoo cyber story

## 1. Problem & motivation

The existing `cyber` plugin (`plugins/cyber/`, branch `plugin-cyber`) measures
**offensive** capability: the model plays the attacker in sandboxed CTF/CVE tasks,
captured flags are scored deterministically, and results are plotted on an
ATT&CK-informed attacker coverage map. James asked for the mirror image: an eval suite
that measures whether a model can **defend** rather than exploit.

**Positioning (not "defensive CTFs").** This is the defensive half of a _symmetric
cyber-capability framework_. Offense measures Observe → Exploit → Persist; defense
measures **Observe → Investigate → Diagnose → Act → Verify**. SP3's live loop later
connects them into one experiment: can an AI attack a system, can it defend one, and
which side is improving faster? That question is the long-term differentiator — more
valuable than either an offensive CTF collection or a defensive QA benchmark.

This document designs the defense suite. It reuses the offense plugin's manifest→
generator pipeline, sandbox, held-out-split mechanism, and assurance gates, and flips
the objective and the scoring.

## 2. Scope decomposition & release ladder

"Defensive CTF, phased, anchored + fresh" is three sub-projects; this spec designs
**SP1 only**. Orthogonally, SP1 itself ships on a **release ladder** — the first cut is
explicitly a _harness-validation_ release, never marketed as a capability benchmark.

| Sub-project | Scope                                                                                       | Status            |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------- |
| **SP1**     | Blue-team task suite — `DefenseTask` contract, scorers, defender coverage map, first corpus | **Designed here** |
| SP2         | Anchor slice — integrate an external defensive benchmark through the same runner            | Roadmap (§12)     |
| SP3         | Live attack–defense loop — a cyber range where offense and defense agents meet              | Roadmap (§12)     |

| Release                       | Target                                     | Claim                                                                                               |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **v0.1 — Harness Validation** | 8–12 tasks                                 | Proves the contract, scorers, sandbox, anti-cheat, promptfoo integration. **No capability claims.** |
| v0.5 — Research Preview       | 30–50 task families + generated instances  | L2/L3 tasks, held-out variants, first human baselines, category-level comparisons                   |
| v1.0 — Benchmark              | Broad families + hidden/generated coverage | Investigation, remediation, detection, containment, recovery; baselines; stable stats               |

**This spec is v0.1.** v0.5/v1.0 items appear only in the roadmap (§12).

## 3. Decisions (resolved)

The four open questions from v1 are now answered (external review + user direction):

- **Base branch — RESOLVED: cut from `plugin-cyber`.** The defense architecture is
  intentionally dependent on the offense infra (manifest pipeline, sandbox, 29 targets,
  split policy). A `main`-based branch would lack it. `plugin-defense` currently sits on
  `main` + this spec commit; re-homing onto `plugin-cyber` is a one-commit rebase, done
  when we start building (offered, not silent — the user just placed the branch).
- **First batch — RESOLVED: 8–12 tasks, named "v0.1 Harness Validation."**
- **Detection engine — RESOLVED: Sigma first.** YARA/network follow once the shared
  scorer/contract is proven.
- **External anchor — RESOLVED: deferred to SP2.** Do not weaken the internal benchmark
  to make a "comparable to X" marketing claim; it must stand alone.
- **Packaging:** sibling bundle `plugins/cyber-defense/` (its own version + marketplace
  entry). **Scoring:** deterministic-first; model-graded only as a labeled-key fallback.

## 4. Core principle: outcome-based, two-sided defense

Offense has a perfect referee — the flag was captured or it wasn't. Defense has none,
and every defensive task has a lazy answer that looks perfect. So the benchmark
formalizes one universal rule:

> **A defense succeeds only when the threat outcome improves AND required legitimate
> capability remains intact.**

| Domain              | Security side                | Utility side                   |
| ------------------- | ---------------------------- | ------------------------------ |
| Patch               | attack prevented             | functionality preserved        |
| Detection           | malicious activity detected  | benign activity tolerated      |
| IOC extraction      | true indicators recovered    | irrelevant indicators excluded |
| Containment (later) | attacker progression stopped | legitimate environment usable  |

**Enforced by architecture, not convention.** The manifest validator (extending the
offense `gen_catalog.py` lifecycle validation) **rejects any task whose
`verifier.security_checks` or `verifier.utility_checks` is empty.** That single schema
rule is what turns "two-sided" from prose into an invariant.

## 5. The `DefenseTask` contract (the P0 architecture)

The largest structural decision: do **not** build `PatchTask`, `DetectionTask`,
`ForensicsTask` as independent scoring systems. Define one `DefenseTask` contract that
all task families implement. This is the manifest schema for the defense catalog —
the direct analogue of the offense `tasks/catalog.manifest.json` → `gen_catalog.py` →
Inspect `eval.yml` + compose + loader pipeline. **`DefenseTask` is a schema layered on
the existing harness, not a new Python framework.**

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
    security_checks: [ ... ]   # MUST be non-empty (validator-enforced)
    utility_checks:  [ ... ]   # MUST be non-empty (validator-enforced)
    anti_cheat_checks: [ ... ]
  scoring: { metrics: [...], gates: {...}, aggregation: security_x_utility }
  taxonomy: { nist_csf: [], d3fend: [], attack: [], cwe: [] }
  contamination: { public: bool, variant_family: id }
  result_type: pass|security_failure|functional_failure|partial|invalid|timeout|environment_failure|policy_block|verifier_failure
```

Because SP3 (live loop) is just another **execution mode** of the same `DefenseTask`
(environment → defender acts → adversary attacks → security + utility verifier →
score), we avoid bolting SP3 on as a separate architecture later.

**Scope discipline (pushback).** Adopting a general contract does **not** mean building
every task family now. v0.1 validates the contract against the four categories in §7
only; the abstraction stays minimal and grows as concrete families are added. Guard
against over-generalizing before there are 2–3 real task types to test it against.

**Verify in planning:** inspect the actual offense `eval.yml`/compose/loader + manifest
on `plugin-cyber` before finalizing field names, so the contract maps onto the real
harness rather than an assumed one.

## 6. Capability layers

Tasks are labeled by what they actually demand — these are not interchangeable:

| Layer             | Demands                                                                | v0.1?               |
| ----------------- | ---------------------------------------------------------------------- | ------------------- |
| **L1 Knowledge**  | identify a technique, classify an indicator, spot a vulnerable pattern | diagnostic only     |
| **L2 Artifact**   | produce a patch / Sigma rule / IOC set / answer                        | **yes — v0.1 core** |
| L3 Operations     | inspect an environment, discover the cause, act, validate              | v0.5+               |
| L4 Active defense | contain a live/replayed adversary while preserving service             | v1.0 / SP3          |

Every task declares its layer. v0.1 is L1–L2; the suite must not present L2 artifact
generation as agentic (L3/L4) defense.

## 7. v0.1 categories (all deterministically scored)

**A. Patch & Harden — flagship, L2 (directed remediation).**

- **Given:** the target source, a functional regression suite, and a weakness report
  (the bug _class_, not the exploit).
- **Produce:** a patch (diff).
- **Security check — an attack _family_, not one string:** the public reference exploit
  - ≥1 _structurally different_ variant + ≥1 **held-out** variant (kept out of the
    public tree via the offense `split.policy.json` mechanism, or generated at eval time).
    All must fail against the patched target. A single mutated payload is insufficient —
    swapping one SQLi string for a similar one does not prove the bug is closed.
- **Utility check — a real regression suite,** not one benign request: normal + multiple
  valid inputs, authorization, negative/boundary inputs, and key API invariants. The
  suite must still pass.
- **Anti-cheat / explicitly penalized:** removing the endpoint, disabling the feature,
  blanket-erroring suspicious input, broad access denial, breaking auth → utility fails.
- **Score:** `overall = security × utility` with hard minimum gates; component scores
  always reported (§8). Perfect security + dead service = failure, not a mediocre pass.

> **Cost, honestly (third and final walk-back of "free win").** The exploit-fails signal
> is free from the offense suite. But the review's stronger verifier means each target
> needs a **variant family** and a **multi-case functional regression suite**. **To
> verify in planning:** inspect 2–3 targets' compose/`eval.yml` for existing functional
> tests. If absent (likely — the offense targets ship reference _exploits_, not benign
> regression suites), Category A is **"cheaper than authoring targets from scratch, but
> each target needs a variant family + a regression suite"** — real per-target work, not
> a freebie.

**B. Detection Engineering — L2. v0.1 = B1 (directed).**

- **Given:** a threat description + example events. **Produce:** a Sigma rule.
- **Verifier:** compile + run over a **held-out, benign-majority** corpus containing true
  positives, benign majority, **near-miss benign** events, and structurally varied
  malicious events. Report **precision, recall, F1, FPR, FNR** — not one combined number
  (deployment contexts weight false-positives vs false-negatives very differently).
- **Rejects:** match-all (precision collapses on benign majority); match-none (recall 0).
- **Roadmap:** B2 _detection discovery_ (infer the suspicious behavior from mixed
  telemetry first) — v0.5.

**C. Telemetry / IOC Investigation — L2 (→ Investigation later).**

- **Given:** intrusion telemetry with benign noise + decoys. **Produce:** a **typed,
  normalized** indicator set (IP/domain/URL/hash/process/user/host/file/registry/cloud-
  identity/ATT&CK-technique), each with a canonical value + aliases.
- **Verifier:** normalize equivalent representations, then precision + recall vs ground
  truth with decoys present; gate on both. Raw set-intersection is too weak.
- **Distinction to grow into:** _observation_ ("this IP appears") vs _security
  conclusion_ ("this IP is the C2") — not equal accomplishments. v0.1 scores the set;
  v0.5 scores the conclusion.
- **Rejects:** dump-everything (precision collapses).

**D. Forensic / Incident Triage — L2 (→ agent-inspects-artifacts later).**

- **Given:** synthetic incident artifacts. **Produce:** answers to **dependent**
  investigative questions (patient-zero host → initial-access vector → compromised
  identity → persistence → blast radius → data touched → appropriate containment).
- **Verifier:** exact / set match vs a fixed answer key with distractors. Dependent
  questions test a coherent incident hypothesis, not isolated guesses.
- **Rejects:** guessing (low match across many linked questions).
- **Roadmap:** the agent inspects a real artifact tree (`/var/log`, process list,
  timeline) itself rather than reading a summary — v0.5, avoids collapsing into reading
  comprehension.

## 8. Scoring architecture

- **Per-task:** normalized component scores — `security`, `utility`, (later)
  `investigation`, `anti_cheat` — plus `overall = security × utility` with hard gates.
  **Component scores stay visible even when overall gates to 0**, so a patch that fixed
  the bug but broke one functional test is distinguishable from a no-op.
- **Per-category** reporting; a model strong at writing detection rules but unable to
  remediate a service must not read as generically "strong at cyber defense."
- **Explicit result types** (never collapse to pass/fail): `pass`, `security_failure`,
  `functional_failure`, `partial`, `invalid`, `timeout`, `environment_failure`,
  `policy_block`, `verifier_failure`. **Invalid/harness runs never count as model
  failures.**
- **Resource cost recorded from day one** (tokens, tool calls, wall-clock) with an
  **identical interaction budget across models** wherever a comparison is claimed.
  Comparative metrics (success@budget, actions-to-remediation) are v0.5+; v0.1 just
  records the fields.

## 9. Three kinds of validity (kept separate)

The offense Gate-0A/0B model is reused, but three distinct questions must not be
conflated:

1. **Harness assurance** — did the experiment run correctly? (container up, isolation
   applied, nonce generated, verifier ran, no OOB access, timeout handled). This is
   Gate-0A/0B territory.
2. **Task validity** — does the task distinguish good from bad defense? Every task ships
   four calibration fixtures: **reference-good → pass, known-bad → fail, degenerate →
   fail, overfit → fail.** All must behave before any model runs.
3. **Benchmark validity** — does the whole suite measure capability? (diversity,
   difficulty spread, ranking stability, contamination, human baselines, CIs). **v0.5+;
   not claimed for v0.1.**

## 10. Taxonomy (coverage/reporting layer, not a scoring ontology)

- **NIST CSF 2.0 — six functions:** Govern, Identify, Protect, Detect, Respond, Recover.
  **Govern is intentionally out of scope**; do not manufacture tasks to claim coverage.
  Reporting: `Govern — not evaluated · Identify — partial · Protect — evaluated · Detect
— evaluated · Respond — evaluated · Recover — partial`.
- **MITRE D3FEND — optional, fine-grained; blank where no clean mapping** (`d3fend: []`
  is more defensible than a misleading map).
- **ATT&CK** (adversary behavior defended against) + **CWE** (underlying weakness) also
  attached where they apply, giving a richer graph: threat→ATT&CK, weakness→CWE,
  defense→D3FEND, lifecycle→CSF.

v0.1 category spread (honest gaps): A→Protect/CWE/D3FEND-Harden; B→Detect/ATT&CK;
C→Detect,Respond/ATT&CK; D→Respond,Recover. Identify & Recover thin; Govern absent.

A coverage-map script mirrors offense's `build_coverage_map.py`, keyed to
`task_defense_map.json`.

## 11. Contamination & hidden evaluation

Everything committed to promptfoo is **public** — there is no "committed but private"
pool. Three honest classes:

- **Public reference tasks** — for docs/repro/debug; may become contaminated; carry low
  benchmark weight.
- **Held-out tasks** — kept outside the public tree via the existing offense
  `split.policy.json` / `split.py` / `held-out-split.md` mechanism.
- **Procedurally varied tasks** — variants generated **at eval time** from a mutation
  strategy (identifiers, ports, filenames, timestamps, topology, payload representation,
  vulnerable parameter, log ordering), so memorizing one instance doesn't generalize.

The per-run nonce protects the _flag_; it does **not** protect the task _solution_ from
memorization — that's what held-out + procedural variation are for.

## 12. Roadmap (SP1 v0.5/v1.0 + SP2 + SP3) — not built here

| Track         | Adds                                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch levels  | L2 localization (component not named) → L3 investigation (discover root cause) → L4 active defense                                                                                                                                                                                                              |
| Detection     | B2 discovery mode; YARA (files) + network detection                                                                                                                                                                                                                                                             |
| Investigation | Category C → typed investigation with security conclusions                                                                                                                                                                                                                                                      |
| Forensics     | agent inspects a real artifact tree, not a summary                                                                                                                                                                                                                                                              |
| New families  | Identity/Access remediation, Config hardening, Containment, Recovery (fills Identify/Recover)                                                                                                                                                                                                                   |
| Rigor         | private/held-out pools, procedural generation, human baselines, benchmark-validity stats                                                                                                                                                                                                                        |
| **SP2**       | External anchor only if it has relevant capability + usable license + reproducible exec + compatible semantics; scan `inspect_evals` for detection/patch tasks; else defer                                                                                                                                      |
| **SP3**       | Cyber range: `Environment ↔ Attacker Agent / Defender Agent → objective verifier`; measures attacker-objective-achieved, time-to-detection/containment/remediation, availability. Verifier observes objective state, **not** an LLM judging which agent "did better." User-run (classifier blocks the harness). |

## 13. Reuse of offense infrastructure

| Offense component (`plugin-cyber`)                     | Defense use                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog.manifest.json` + `gen_catalog.py`             | The `DefenseTask` contract is the defense manifest; extend the generator + its lifecycle validation (enforces non-empty security/utility checks) |
| `split.policy.json` / `split.py` / `held-out-split.md` | Held-out exploit variants + held-out detection corpora                                                                                           |
| `scripts/provider.py` (promptfoo ↔ Inspect)            | Defense tasks are Inspect tasks with a defensive scorer                                                                                          |
| Colima VM + `egress-lockdown.sh`                       | Sandbox for any task that executes code (Category A)                                                                                             |
| Gate-0A / Gate-0B                                      | Harness-assurance validity (§9.1); per-run nonce, N-attempt, Wilson, controls                                                                    |
| `anti_cheat.py`                                        | Defense equivalent: attack-family, benign-majority, decoys, typed normalization                                                                  |
| 29 targets + reference exploits                        | Category A environments + the security-check's public probe (variant family + regression suite are new authoring — §7 A)                         |

## 14. Packaging

`plugins/cyber-defense/` sibling bundle. Concerns kept **separable** (the reviewer's
key architectural constraint): task definition (manifest) / execution (generator +
Inspect) / scoring (per-metric scorers) / anti-cheat / taxonomy.

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
  _authoring + calibration self-tests_ (reference-good pass, known-bad/degenerate/overfit
  fail, Sigma precision/recall on a fixed corpus) are deterministic and runnable without
  a model.
- Build on `plugin-cyber` (§3); re-home `plugin-defense` at build time.

## 17. v0.1 acceptance criteria

- **Harness:** tasks run through the promptfoo/Inspect bridge; sandbox isolated; per-run
  nonce works; invalid runs distinguished from model failures; reference runs reproduce.
- **Contract:** every task conforms to `DefenseTask`; declares capability layer, allowed
  actions, and deterministic verification; validator rejects empty security/utility.
- **Security (patch):** original exploit fails; ≥1 structural + ≥1 held-out variant
  exist and fail; exploit-string patches rejected.
- **Utility (patch):** meaningful multi-case regression suite; block-all/destructive
  defenses fail.
- **Detection:** benign-majority held-out corpus; precision + recall (+ F1/FPR/FNR)
  measured; match-all and match-none fail.
- **Investigation:** decoys included; typed normalization; dump-all cannot pass.
- **Calibration:** every task ships reference-good / known-bad / degenerate / overfit and
  all behave as expected **before any model benchmark runs.**

## 18. Non-goals (YAGNI for v0.1)

- No live malware. No L3/L4 (operations/active defense) tasks. No SP3 live loop. No SP2
  anchor. No Identity/Config/Containment/Recovery families. No human baselines or
  benchmark-validity statistics. No heavy model-graded rubric scoring. No full D3FEND or
  CSF coverage (Govern out of scope).

## 19. Verification items for the planning phase

Carried from the review + advisor as things to confirm before finalizing the plan
(cannot be verified from a `main`-based worktree):

1. Inspect the real offense `eval.yml`/compose/loader + `catalog.manifest.json` on
   `plugin-cyber` — finalize `DefenseTask` field names against it.
2. Inspect 2–3 of the 29 targets for existing functional tests — sizes Category A cost.
3. Eyeball `git log plugin-cyber -5` before re-homing (tip `ed1774864` looks like the
   parallel session's work landed; `ls-tree` already confirmed the infra is at tip).
