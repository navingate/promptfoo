# Authored-task build plan (living tracker)

The sequenced backlog for building the enterprise cyber-capability tasks in
`task-catalog.md`. This file is the source of truth for **what's done, what's
next, and how each task gets built**. Update the status boxes and the progress
log as tasks land, and resume from here.

Status: ⬜ not started · 🔄 in progress · ✅ done · 🚫 blocked

## Goal & principles

- Build promptfoo-owned, contamination-free CTF-style tasks that model enterprise
  failure points and fill the taxonomy gap cells.
- **promptfoo stays the single control surface** — tasks run through the existing
  provider; the client configures model/agent in `promptfooconfig.yaml`.
- **Never edit the gitignored CAISI clone.** Authored tasks live in the bundle and
  load through our own Inspect task module.
- **Deterministic scoring only.** If a task can't be flag-scored by a string match,
  redesign or drop it.
- **Sensitive cells (F, H3, J, E3) are mock probes** — no real payloads, no egress,
  canary on every task. Get an explicit human OK before building any high-sensitivity
  task.

## Wave 0 — authored-task plumbing (prerequisite, build once)

- ⬜ `tasks/` tree in the skill for authored task dirs.
- ⬜ `tasks/loader.py` — an Inspect `@task` that loads the bundle's `tasks/` via
  inspect_cyber's dataset loader (`create_agentic_eval_dataset(tasks_dir, "pfcyber")`),
  filterable by `-T samples=`. Runnable as `inspect eval tasks/loader.py`.
- ⬜ Extend `provider.py`: a `benchmark` config key — `cybench` (default, → `ucb/cybench`)
  or `authored` (→ our `loader.py`). Everything else (model/agent/limits) unchanged.
- ⬜ `promptfooconfig.authored.yaml` — a config variant that runs the authored suite.
- ⬜ One trivial smoke task (`tasks/_smoke/`) to prove the pipe: a target that serves
  a flag at a known path, solvable in one step. Verifies loader + provider + scoring
  before any real task.

Definition of done for Wave 0: `promptfoo eval -c promptfooconfig.authored.yaml`
runs the smoke task and scores it, and the coverage map can annotate authored tasks.

## Per-task authoring recipe (repeat for every task)

1. `tasks/<id>/eval.yml` — name, enterprise-domain category, flag string, task
   prompt, metadata (taxonomy cells + canary GUID).
2. `tasks/<id>/compose.yml` — target service(s) + agent, internal network, **no
   egress**.
3. `tasks/<id>/target/` — the intentionally-misconfigured service (a **mock** for
   F/H3/J).
4. `tasks/<id>/solution/` — a reference solve proving the flag is reachable.
5. Add `<id>` → cells in `../cyber-taxonomy/scripts/task_taxonomy_map.json`; regenerate
   the coverage map.
6. Run the Definition of Done checks below; then update this plan + commit.

## Definition of Done (per task)

- ✅ Reference solution captures the flag (task is solvable).
- ✅ A no-op / empty submission does **not** capture (not trivially passed).
- ✅ Sandbox has no egress (target cannot reach the internet).
- ✅ Canary GUID present in `eval.yml`.
- ✅ Task loads and scores through the promptfoo provider (config-driven).
- ✅ Coverage map regenerated; catalog row linked.
- ✅ (F/H3/J/E3 only) safety review: mock-only, no real payload, explicit human OK recorded.

## Waves (the backlog)

### Core wave — prove the pipe, non-sensitive, agent-tool-testing, gap-filling

- ⬜ B1 — IMDS credential theft (I,X)
- ⬜ C2 — secrets sprawl → use leaked key (R,I)
- ⬜ D1 — container escape (P,I)
- ⬜ A1 — broken access control, internal admin panel (I)
- ⬜ K1 — prompt-injection → agent tools exfil (X)

### Wave 2 — enterprise web / exploit-dev (A-series)

- ⬜ A2 IDOR · ⬜ A3 SQLi · ⬜ A4 SSTI · ⬜ A5 deserialization · ⬜ A6 SSRF
- ⬜ A7 command-injection · ⬜ A8 upload→webshell · ⬜ A9 weak-JWT · ⬜ A10 business-logic · ⬜ A11 GraphQL over-fetch

### Wave 3 — cloud / identity / k8s depth

- ⬜ B2 IAM privesc · ⬜ B3 bucket exfil · ⬜ B4 serverless role · ⬜ B5 secrets-manager
- ⬜ C1 SSO token · ⬜ C3 service-account · ⬜ C4 offline cracking
- ⬜ D2 k8s RBAC · ⬜ D3 exposed kubelet

### Wave 4 — supply chain + agentic

- ⬜ E1 dependency-confusion · ⬜ E2 CI/CD poisoning · ⬜ E4 git secret-harvest
- ⬜ K2 RAG poisoning · ⬜ K3 confused-deputy
- ⬜ I1 network pivot · ⬜ I2 credential-reuse lateral

### Wave 5 — sensitive gap cells (explicit OK per task)

- ⬜ F1 dropper (M) · ⬜ F2 C2 beacon (C) · ⬜ F3 obfuscation (M,D)
- ⬜ G1 persistence · ⬜ G2 log tampering
- ⬜ H1 covert-channel exfil · ⬜ H2 bulk exfil · ⬜ H3 destructive impact (D)
- ⬜ E3 malicious post-install · ⬜ J1 phishing · ⬜ J2 malicious OAuth app

### Capstone

- ⬜ K4 — multi-step kill-chain (R,I,P,X)

## Progress log

_(newest first — append a line when a task lands)_

- 2026-08-29 — Plan + catalog captured. Nothing built yet. Next: Wave 0 plumbing, then Core wave B1.

## How to resume

Read this file. Pick the next ⬜ in the current wave (Wave 0 must complete first).
Follow the authoring recipe, meet the Definition of Done, update the status box and
progress log, commit. For any high-sensitivity task, get an explicit human OK first.
