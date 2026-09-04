# Cyber Defense CTF Evals — Design

**Date:** 2026-09-04
**Status:** Draft for review
**Owner:** navingate (core@astroware.ai)
**Audience:** promptfoo maintainers; positioning for James / OpenAI-promptfoo cyber story

## 1. Problem & motivation

The existing `cyber` plugin (`plugins/cyber/`, branch `plugin-cyber`) measures
**offensive** capability: the model plays the attacker in sandboxed CTF/CVE tasks,
captured flags are scored deterministically, and results are plotted on an
ATT&CK-informed attacker coverage map. James asked for the mirror image: a
**cyber-defense** eval suite that measures whether a model can _defend_ — detect,
contain, and remediate — rather than exploit.

This document designs that suite. It reuses the offense plugin's sandbox, runner,
and assurance machinery, and flips the objective and the scoring.

## 2. Scope decomposition

"Defensive CTF, phased, anchored + fresh" is three sub-projects. This spec designs
**Sub-project 1 only**; the other two are roadmap and get their own specs.

| #       | Sub-project                                                                                                    | This spec                                       |
| ------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **SP1** | **Blue-team task suite** — defense runner, defender coverage map, scoring engine, first fresh corpus           | **Designed here**                               |
| SP2     | Anchor slice — integrate an established external defensive benchmark through the same runner for comparability | Roadmap (§10)                                   |
| SP3     | Live attack–defense loop — model patches a service, the offense harness attacks it                             | Roadmap (§9) — SP1 is designed so this drops in |

## 3. Design decisions (confirmed with user)

- **Eval shape:** both, phased. SP1 static blue-team tasks first; SP3 live loop later.
- **Sourcing:** both an anchored slice (SP2) and a fresh, D3FEND-mapped slice (SP1).
- **Packaging:** a **sibling** plugin bundle `plugins/cyber-defense/`, not new skills
  inside `plugins/cyber/`. Its own versioning and marketplace entry.
- **Branch:** a **new branch** for the defense work. Working assumption: cut it off
  `plugin-cyber` so it inherits the offense infra and the 29 reference targets.
  **Open item — confirm (§11).**
- **Scoring:** deterministic-first. Every task scored by a runnable two-sided check;
  model-graded scoring only as a labeled-key fallback where no deterministic oracle
  exists.

## 4. The core problem: scoring defense without an oracle

Offense has a perfect referee — the flag was captured or it wasn't. Defense has none.
Every defensive task has a lazy "solution" that looks perfect and defeats the point.
So **every task must apply a two-sided check**: the defense must _work_ AND not _cheat_.
This is the spine of the design and the first thing a skeptical reviewer will probe.

| Task type                    | Gamed / degenerate answer           | The check that rejects it                                                                             |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Patch a vulnerable service   | delete the feature, block all input | re-run the attack (must now fail) **and** run the service's own functional tests (must still pass)    |
| Write a detection rule       | a rule that matches everything      | run it over a labeled corpus with a **benign majority**; score precision **and** recall, gate on both |
| Extract indicators from logs | list every value present            | overlap vs a ground-truth set with **decoys** mixed in; over-listing collapses precision              |
| Forensic triage questions    | vague or guessed answers            | exact / set match vs a fixed answer key, with distractor options                                      |

Two cross-cutting anti-cheat rules, mirroring offense's `anti_cheat.py` + held-out split:

1. **Held-out variant.** Where a task is scored by "the attack now fails," a _second,
   mutated_ attack variant (different payload, same root cause) must also fail. This
   rejects fixes that pattern-match the exact exploit string instead of closing the
   bug.
2. **Benign majority / decoys.** Detection and extraction tasks are scored against
   sets where benign items outnumber malicious ones and plausible decoys are present,
   so "flag everything" scores badly.

## 5. Sub-project 1 — the blue-team suite

### 5.1 First-batch categories (all deterministically scored)

**A. Patch & Harden — the flagship (and the cheapest to build).**
The offense suite already ships 29 vulnerable targets, each with a _working reference
exploit_ and a per-run flag. A vulnerable target + a known exploit is most of a patch
task's referee for free; the rest is light per-target authoring (below).

- **Given:** the target source, a functional check, and a weakness report (the bug
  _class_, not the exploit script).
- **Produce:** a patch (diff) applied to the target.
- **Verifier (two-sided, deterministic):**
  - re-run the reference exploit against the patched target → must **fail** to capture
    the per-run flag; _(free — reuses the existing exploit)_
  - run a **functional check** → must **pass**; _(light authoring: assert the intended
    benign request still returns its expected non-flag response — a few lines per
    target, since these are ~50-LOC targets)_
  - re-run a **held-out** exploit variant → must also fail (anti-overfit). _(authoring:
    a mutated payload with the same root cause — light for simple targets, and the
    honest cost of a credible anti-cheat)_
- **Rejects:** endpoint deletion / block-all (functional check fails); exploit-string
  matching (held-out variant still succeeds).

**Cost, honestly:** the exploit-fails side is free; the functional check and held-out
variant are per-target authoring, light because the targets are small. Not zero, but
far cheaper than authoring targets from scratch. This category also reuses the exact
target format that SP3's live loop needs, so building it _is_ "design for act two from
day one."

**B. Detection Engineering.**

- **Given:** a threat description and a few example events (not the scoring set).
- **Produce:** a detection rule. **Sigma** (log detection) is the v1 engine —
  pure-Python evaluable, ATT&CK-mapped, deterministic. YARA (files) and Suricata-style
  (network) are follow-ups.
- **Verifier:** compile the rule, run it over a held-out labeled corpus with a benign
  majority; compute precision and recall; gate on both.
- **Rejects:** match-all (precision collapses); empty rule (recall zero).

**C. Log / Telemetry Triage & IOC Extraction.**

- **Given:** an intrusion's logs/telemetry with benign noise and decoys.
- **Produce:** a structured indicator set (IPs, hashes, users, hosts, techniques).
- **Verifier:** set overlap (precision + recall) vs ground truth, decoys present;
  gate on both.
- **Rejects:** dump-everything (precision collapses).

**D. Forensic / Incident Triage (checkable Q&A).**

- **Given:** synthetic incident artifacts (disk/timeline/log summaries, memory-analysis
  output — all benign/synthetic).
- **Produce:** answers to specific questions (patient-zero host, timeline, technique,
  data touched).
- **Verifier:** exact / set match vs a fixed answer key; enough questions + distractors
  that guessing is penalized.
- **Rejects:** guessing (low match across many questions).

### 5.2 Defender coverage map (the differentiator)

Symmetric to the offense ATT&CK map:

- **Coarse axis — NIST CSF five functions:** Identify, Protect, Detect, Respond,
  Recover. Every task maps to at least one; this carries the headline coverage claim.
- **Fine axis — MITRE D3FEND** (the defender counterpart to ATT&CK): map a task to a
  D3FEND technique only where the mapping is clean. **v1 does not promise full D3FEND
  coverage** — the five functions are the honest headline, D3FEND adds depth where it
  fits.

First-batch spread (honest gaps noted):

| Category                 | NIST CSF         | D3FEND tactic     |
| ------------------------ | ---------------- | ----------------- |
| A. Patch & Harden        | Protect          | Harden            |
| B. Detection Engineering | Detect           | Detect            |
| C. Log/IOC Triage        | Detect, Respond  | Detect (analysis) |
| D. Forensic/IR Triage    | Respond, Recover | Evict / Restore   |

Identify and Recover are thin in v1 — a stated gap, not a hidden one.

A coverage-map script mirrors offense's `build_coverage_map.py`, keyed to a
`task_defense_map.json` (task → CSF function(s) + D3FEND technique(s)), and folds a
promptfoo run's results into a defender coverage grid.

### 5.3 Reuse of the offense infrastructure

| Offense component (on `plugin-cyber`)              | Defense use                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/provider.py` (promptfoo ↔ Inspect bridge) | Reuse the pattern; defense tasks are Inspect tasks with a defensive scorer                                                                      |
| Colima VM + `egress-lockdown.sh` sandbox           | Reuse for any task that executes code (Category A runs target + exploit)                                                                        |
| Gate-0A (calibration) / Gate-0B (assurance)        | Inherit the two-gate model: 0A = static per-build calibration; 0B = per-run nonce, N-attempt Pass@k, Wilson CI, controls, OOB verifier          |
| `anti_cheat.py`                                    | Author a defense equivalent (held-out variant, benign-majority, decoys)                                                                         |
| The 29 targets + reference solves                  | Become Category A patch tasks; the exploit-fails check is free, the functional check + held-out variant are light per-target authoring (§5.1 A) |

For Category A, the per-run nonce still applies: the target serves a per-run flag and
"defended" means the exploit cannot capture **this run's** flag. Fail-closed →
`invalid` and excluded from measurement, same as Gate-0B offense.

### 5.4 Packaging

`plugins/cyber-defense/` sibling bundle, mirroring `plugins/cyber/`:

```
plugins/cyber-defense/
  .claude-plugin/plugin.json      # name: cyber-defense, version 0.1.0
  .codex-plugin/plugin.json
  DEFENSE.md                       # operator guide (setup / run / catalog / scope)
  skills/
    cyber-defense-run/             # the runner: tasks, scorers, promptfoo wrapper, deploy
    cyber-defense-taxonomy/        # the NIST-CSF/D3FEND coverage map
```

Wired into the marketplace test alongside the other bundles (see the shared
plugin-test invariants).

## 6. Dual-use / safety guardrails (goes in the spec, enforced in the corpus)

- **No live malware is authored or hosted.** Detection and triage corpora use logs of
  known techniques (Atomic-Red-Team-style telemetry), Sigma's own test logs, EICAR-class
  benign test files, and synthetic forensic artifacts — never real payloads or binaries.
- **No adversarial content laundered through an uncensored model.** Consistent with the
  offense project's standing rule.
- Category A reuses already-scoped, already-reviewed offense targets and exploits — no
  new offensive artifacts are created.
- The defensive framing is the benign twin of the offense taxonomy: same vocabulary,
  authorization and intent are defensive throughout.

## 7. Testing & verification

- Each task ships a **reference defense** (the known-good patch / rule / answer key)
  that must score a pass, and a **known-bad** input (the degenerate answer) that must
  score a fail. This is the calibration proof that the two-sided check works — the
  defensive analogue of offense's reference-solve self-test.
- A defense `anti_cheat` self-test: for every Category A task, confirm the held-out
  variant rejects an exploit-string-matching patch.
- Marketplace / plugin structure test extended to cover the new bundle.
- Gate-0A calibration first (static, per-build); a real capability verdict needs
  Gate-0B measurement (per-run nonce, N-attempt, controls) — **user-run**, see §8.

## 8. Execution & environment constraints

- **The live loop (SP3) and any real agent run are user-run.** The auto-mode safety
  classifier blocks executing the offense harness (the SP3 adversary) and external
  model calls, exactly as with the offense `run_0a.sh`. SP1's _authoring and
  calibration self-tests_ (reference-defense passes, known-bad fails, rule precision/
  recall on a fixed corpus) are deterministic and runnable without a model or the
  harness; the _capability verdict_ against a live model is the user's run.
- Build on `plugin-cyber`'s infra (§11 open item); designing against infra absent from
  the branch would yield an unexecutable plan.

## 9. SP3 preview — live attack–defense loop (designed-for, not built)

Because Category A tasks already share the offense target format, the live loop is:
give the model the vulnerable target, let it patch, then run the **offense agent**
against the patched target. Pass if the flag is **not** captured within the budget AND
an availability/functional check still holds (the "king of the hill" format). Scoring
adds an availability SLA on top of Category A's verifier. Built in SP3; user-run.

## 10. SP2 preview — anchor slice (deferred, needs a search)

Comparability to a name-brand benchmark is easier on offense (Cybench) than on defense
(younger, more fragmented landscape). SP2 will, before naming anything: (a) scan the
`inspect_evals` registry for tasks whose objective is detection/patching rather than
exploitation — those plug into the reused provider almost free; (b) check whether a
threat-intel benchmark (e.g. CTIBench-class) has a clean license and an Inspect port.
If neither pans out cleanly, SP2 says so; a shaky anchor must not delay SP1.

## 11. Open questions (for user review)

1. **Base branch — confirm.** Plan assumes a new branch off `plugin-cyber` (inherits
   infra + 29 targets). Alternative: off `main` + merge the infra first. Which?
2. **First-batch size.** Proposed ~8–12 tasks: ~4–6 Category A (reuse existing targets)
   - 2–3 Category B + 2 Category C + 2 Category D. Calibration-grade, not a capability
     benchmark. OK?
3. **Detection engine order.** Sigma first (log detection), YARA/Suricata later. OK?
4. **SP2 anchor** is deferred pending the registry/license search above — acceptable to
   leave the "comparable-to-X" claim as SP2's problem, not SP1's?

## 12. Non-goals (YAGNI for SP1)

- No live malware authoring or hosting.
- No full D3FEND coverage in v1 (five CSF functions carry the headline).
- No live attack–defense loop (SP3).
- No external anchor benchmark integration (SP2).
- No heavy model-graded rubric scoring (deterministic-first).
