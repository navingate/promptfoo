---
name: cyber-defense-run
description: Run sandboxed cyber-defense capability evals through promptfoo — the model produces a defensive artifact (v0.1: a patch), and a deterministic two-sided scorer verifies the threat is closed without breaking legitimate function. Use when evaluating a model's blue-team/defensive capability, not its offensive capability.
---

# Cyber Defense Run

Runs blue-team capability tasks through promptfoo, reusing the offensive `cyber` plugin's
Docker sandbox and targets. Each task is a `DefenseTask`: the model is given evidence (v0.1:
vulnerable source + a weakness report) and returns a defensive artifact (v0.1: a patch); a
deterministic scorer applies it and verifies a **two-sided** outcome — the objective is
achieved (exploit family closed) AND the constraint holds (legitimate function preserved).

**Scope: v0.1 Harness Validation.** Two slices are runnable today — the A3 SQL-injection
**patch** task (Slice 1) and the **F2 federation detection** correlation task — both scored
through the same frozen two-sided `DefenseTask` contract. See the design spec
(`docs/superpowers/specs/2026-09-04-cyber-defense-ctf-evals-design.md`) and the Slice-1
implementation plan (`docs/superpowers/plans/2026-09-06-cyber-defense-v0.1-slice1-patch.md`).

## Run — patch task (Slice 1)

```bash
promptfoo eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.defense.yaml --no-cache -o out.json
```

Requires Docker/Colima (for the sandboxed target). Read `out.json` for `success` and the
`run_status` / `task_outcome` / component scores in the assertion metadata.

## Run — F2 federation detection (correlation slice)

The model reads **de-oracled federation telemetry** and writes a JSON **correlation rule** that
flags claim-smuggling incidents without false-alarming on benign traffic. Scored two-sided —
**recall → objective** (every smuggle caught), **precision → constraint** (no benign false
alarm) — plus an ungated **timing diagnostic** (`pre_privesc_rate`: how much of each attack is
caught _before_ the escalation).

```bash
promptfoo eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.correlation.yaml --no-cache -o out.json
```

No Docker needed — the corpus is a frozen, de-oracled event set. It is integrity-checked at load
(canonical-sha256 + causal order); a lone bundle edit or a causally-inverted bundle scores
`run_status=environment_failure` (a harness fault excluded from model scoring — filter on
`named_scores.run_valid=0`), never a model result. The sha256 is tamper-**evidence**, not a
signature: a coordinated bundle+manifest edit still passes — cryptographic source attestation (a
parked Tier 3 item) is what would close that.

### ⚠️ Known scoring limitation — read before interpreting a pass

On this estate **no benign principal ever legitimately escalates**, so a bare "an escalation
happened" rule scores recall/precision 1.0 and **passes the gate with no smuggle-detection
skill**. That shortcut is _faithful here_ (the IAM gate makes escalation inherently the attack)
but **does not generalize** to an estate with legitimate privileged users. The discriminator that
DOES generalize — **provenance** (was the honored tag smuggled via a self-service source
attribute) — is rewarded only by the ungated **`pre_privesc_rate`** diagnostic: a generalizing
detector scores ~0.78, the escalation-presence shortcut scores 0.00. **Read the timing
diagnostic, not just `task_outcome=pass`.** Making provenance gate-load-bearing needs a benign
legitimate-escalation twin on the offense estate — a parked **Tier 3** enhancement (see the
product roadmap).

### Calibration is stale

Any earlier live-model numbers for this task predate two changes — detection timing moved to
observation-batch coordinates, and the task brief was rewritten to remove solution give-aways —
so they must be **re-run before being quoted**.
