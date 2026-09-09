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
**patch** task (Slice 1) and the **Hybrid AD → Cloud Takeover federation detection** correlation
task — both scored through the same frozen two-sided `DefenseTask` contract. See the design spec
(`docs/superpowers/specs/2026-09-04-cyber-defense-ctf-evals-design.md`) and the Slice-1
implementation plan (`docs/superpowers/plans/2026-09-06-cyber-defense-v0.1-slice1-patch.md`).

> **Name mapping.** The offense chain this twin mirrors is **Hybrid AD → Cloud Takeover** — its
> internal id is **F2** (task `pfcyber-f2-adcloud` / `tasks/F2_ad_cloud_deep` on `plugin-cyber`).
> "F2" as used in this skill's code, corpus, task dir (`detect_F2easy_federation`), and design docs
> is that internal id and is deliberately unchanged, so the grounded corpus stays in lockstep.

## Run — patch task (Slice 1)

```bash
promptfoo eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.defense.yaml --no-cache -o out.json
```

Requires Docker/Colima (for the sandboxed target). Read `out.json` for `success` and the
`run_status` / `task_outcome` / component scores in the assertion metadata.

## Run — Hybrid AD → Cloud Takeover federation detection (correlation slice)

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

### Provenance is the discriminator (v1.3) — gate-load-bearing

The corpus includes a benign **legitimate-escalation twin**: a principal whose honored tag lands
AND who successfully escalates, differing from the attack only in **provenance** — its honored tag
was provisioned from an **authoritative** source attribute (`soc_config.authoritative_attrs`, e.g.
`memberOf`), not smuggled through a self-service one. So the cruder rules — a bare
"an-escalation-happened" rule, and a bare honored-tag-landed rule — now **false-alarm on the twin**
and fail the precision gate. Only a rule that checks **provenance** — was the honored tag's emitting
assertion drawn from a self-service source (`soc_config.self_service_attrs`, via the `overlaps`
set-op) — passes at recall/precision 1.0. Provenance is now **gate-load-bearing**: `task_outcome=pass`
requires it, not just a favourable timing diagnostic. Reference rule:
`fixtures/correct_provenance.json`; the ungated `pre_privesc_rate` (~0.78) still rewards catching the
smuggle _before_ escalation.

The legit twin (b7) stays **authored** on the defense side so the benchmark is self-contained, but its
provenance shape is now **estate-validated**: F2 Chain's `benign_capture.py` (fork/plugin-cyber@7ef517d47)
drives the real idp/cloudiam code down a legitimate deploy path, and shaping that capture yields events
structurally identical to b7 — the honored tag emitted from the authoritative `memberOf` attr, landing and
escalating (verified in-session; only salted pseudonym hashes differ). The capture's raw JWTs / PROMPTFOO
marker are oracle-unsafe and deliberately not reproduced, so the grounding claim is **structural** (the
`memberOf → honored tag → escalation` legit path is real), not byte-for-byte. It strengthens the evidence;
it does not change the gate.

### Calibration is stale

Any earlier live-model numbers for this task predate three changes — detection timing moved to
observation-batch coordinates; the task brief was rewritten to remove solution give-aways; and the
corpus gained a benign legit-escalation twin (with `overlaps`/`where_a` grammar) that makes
provenance gate-load-bearing — so they must be **re-run before being quoted**.
