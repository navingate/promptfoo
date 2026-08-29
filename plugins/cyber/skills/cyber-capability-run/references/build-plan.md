# Authored-task build plan (living tracker)

The sequenced backlog for building the enterprise cyber-capability tasks in
`task-catalog.md`. This file is the source of truth for **what's done, what's
next, and how each task gets built**. Update the status boxes and the progress
log as tasks land, and resume from here.

Status: ⬜ not started · 🔄 in progress · ✅ done · 🚫 blocked

## Goal & principles

Revised after the security review (`enterprise-task-suite-security-review.md`).

- Build promptfoo-owned, **contamination-reduced** enterprise-shaped sandbox tasks
  that model real failure points. ("Contamination-free" is not claimed — a bundled
  static task is a calibration task; a canary is a marker, not a control.)
- **promptfoo stays the single control surface** — tasks run through the provider;
  the client configures model/agent in `promptfooconfig.yaml`.
- **Never edit the gitignored CAISI clone.** Authored tasks live in the bundle and
  load through our own Inspect task module.
- **A Docker Compose network is NOT a security boundary.** Inspect runs custom
  agents/tools/scorers in the eval process, outside the per-sample sandbox — real
  containment (disposable VM/microVM + host-layer egress policy) is a Phase 3 (Gate 0) requirement, not a compose setting.
- **Scoring by outcome, staged by rigor.** Static-flag `includes()` is acceptable
  for smoke QA only. Diagnostic tasks use per-run injected nonces; assurance tasks
  use an out-of-band, replay-resistant verifier. Every attempt resolves to ONE of:
  demonstrated / genuine-non-solve / refusal / budget-exhausted / harness-error /
  invalidated — an error or refusal is never a "non-solve."
- **The taxonomy is ATT&CK-informed, not a direct ATT&CK tactic mapping.**
- **Sensitive cells are mock probes** — no real payloads, no egress, canary on every
  task, explicit human OK, and only after the Phase 3 isolation gate passes.

## Wave 0 — authored-task plumbing (prerequisite, build once)

- ✅ `tasks/` tree in the skill for authored task dirs.
- ✅ `tasks/loader.py` — an Inspect `@task` (`pfcyber`) that loads the bundle's
  `tasks/` via inspect_cyber's dataset loader
  (`create_agentic_eval_dataset(TASKS_DIR, "pfcyber")`), filterable by `-T samples=`.
  Verified: imports, registers as an Inspect task, and discovers the smoke sample
  with the correct flag/metadata via the harness venv.
- ✅ Extend `provider.py`: a `benchmark` config key — `cybench` (default, →
  `ucb/cybench`) or `authored` (→ our `loader.py`). Everything else (model/agent/
  limits, bring-your-own-target env injection) unchanged. ruff + py_compile clean.
- ✅ `promptfooconfig.authored.yaml` — a config variant that runs the authored
  suite (`benchmark: authored`, `task: pfcyber-smoke`). YAML-parses correctly.
- 🔄 One trivial smoke task (`tasks/_smoke/`) to prove the pipe: a target that
  serves a flag at a known path, solvable in one step.
  - ✅ `eval.yml` + `compose.yml` + target Dockerfile/content + reference `solve.sh`.
  - ✅ Target builds, becomes healthy, serves the flag — verified directly
    (byte-exact match) and cross-container via the `target` compose DNS name from
    a second container (the actual path an agent will use).
  - ✅ **Found and fixed a real bug**: the healthcheck used `http://localhost:...`,
    which fails on Alpine/musl (resolves `localhost` to `::1` first; Python's
    `http.server` only binds IPv4) — connection refused despite the server being
    up. Fixed to `127.0.0.1`. Confirmed by reproducing the failure, diagnosing via
    `/proc/net/tcp`, then verifying the fix.
  - ✅ **Verified the safety property, not just asserted it**: with
    `networks.default.internal: true`, the target container could NOT reach an
    external IP (`wget` to 1.1.1.1 → "Network unreachable") while cross-container
    access to `target:8080` still worked. No-egress sandboxing is real, not just
    documented.
  - 🚫 **Blocked (environment):** full agent-driven capture (promptfoo → provider →
    Inspect → `ucb/cybench_agent` → sandbox → flag). Needs the harness's
    `agent-environment:1.1.1` image. Two build attempts failed; root cause
    diagnosed (not transient): Docker here resolves package-mirror hosts to IPv6
    only, and containers have no working IPv6 route + no IPv4 fallback, so any
    in-build `apt-get`/`apk` install fails — confirmed with a plain
    `debian:bookworm-slim` container (`deb.debian.org` unresolvable). Fix is
    host-level (Docker DNS/IPv6), outside this session; or build the image on an
    unrestricted host and `docker load`. Deprioritized: Phase 3 replaces this
    Docker substrate anyway.

Definition of done for Wave 0: `promptfoo eval -c promptfooconfig.authored.yaml`
runs the smoke task and scores it end-to-end, and the coverage map can annotate
authored tasks. **Not yet met** — the direct (non-agent) verification is done; the
agent-driven leg is blocked on the environment above.

## Post-review phases (GOVERNING plan)

Driven by the security review. These three phases supersede the old wave backlog
below (which is retained only for its task IDs, pending Phase 2). Work top-down;
Phase 1 has no dependency on the others and is pure correction.

### Phase 1 — Corrections (fix what's currently wrong; docs + one code bug, no new sandboxes)

- ⬜ 1.1 Fix the catalog count (**43**, not 40); generate counts from one
  machine-readable manifest so prose and tracker can't drift.
- ⬜ 1.2 Relabel taxonomy cells: known-vuln exploitation (A-series) → **I**, not
  exploit-dev **E**; F3/G2/H1 are evasion/anti-forensics, not **D** (only H3 is D);
  strip unearned **P** labels; fix recon-vs-post-compromise-discovery.
- ⬜ 1.3 Reframe as "ATT&CK-**informed**"; add primary/secondary capability,
  required evidence, and explicit ATT&CK technique IDs per task.
- ⬜ 1.4 Split the `Lvl` column into **execution-mode** + **system-under-test**
  (fixed-scaffold-model / client-agent / both).
- ⬜ 1.5 Move/reframe **K1–K3**: they are L2 conduct (agent induced via untrusted
  data), not L3 capability — scoring them as capability rewards a more vulnerable
  agent. Move to `cyber-conduct`, or reframe as attacker-vs-fixed-victim (review
  candidate 16). [depends on the 2.1 disposition decision]
- ⬜ 1.6 Positioning/wording: "NIST CAISI cyber-evals on the **UK AISI** Inspect
  framework" (Inspect is UK AISI, not NIST); "**contamination-reduced**" not
  "-free"; canary = marker, not control; label the public 3-task run as smoke QA,
  not a benchmark/score.
- ⬜ 1.7 Resolve the wrapper contradiction (`caisi-inspect-run.md` says L3.4 is
  deferred; `promptfoo-wrapper.md` describes it as built).
- ⬜ 1.8 Fix `provider.py` outcome handling: return a distinct outcome for
  demonstrated / non-solve / refusal / budget-exhausted / harness-error /
  invalidated. Never count an error or refusal as a non-solve (current bug: both
  collapse to `NOT CAPTURED`).

### Phase 2 — Two-tier restructure + additive staged scenarios

- ⬜ 2.1 **Ratify the disposition mapping** (the review's disposition table) with the
  human: for each of the 43 IDs → keep-atomic / merge-into-scenario / move-layer /
  don't-build-as-written / capstone. This decision defines the two-tier structure.
- ⬜ 2.2 Define the two tiers in the catalog: **Tier 1** atomic diagnostics
  (corrected existing tasks), **Tier 2** staged cross-boundary scenarios.
- ⬜ 2.3 Add the 15 staged scenarios (review candidates 1–15) as Tier 2, plus
  candidate 16 (AI-native victim-agent) when agent-security is the headline.
  **Additive**, not replacements; do not double-count an atomic task and the
  scenario that contains it.
- ⬜ 2.4 Move to a single machine-readable manifest → generate catalog tables,
  counts, and coverage from it.
- ⬜ 2.5 Coverage reporting distinguishes catalogued / built / reference-validated /
  executed / demonstrated — no single "covered" number.

### Phase 3 — Gate 0: execution substrate + measurement (staged; the real blocker for assurance-grade)

- ⬜ 3.1 **Pull-forward, urgent:** remove the host Docker-socket mount from
  `deploy/devcontainer.json`; stop calling the compose network a security boundary;
  add the honest containment caveat to the docs.
- ⬜ 3.2 Confirm the "solver/scorer run outside the sandbox" boundary against
  `inspect.aisi.org.uk/sandboxing.html` — the premise the isolation design rests on.
- ⬜ 3.3 Design the isolation substrate (disposable VM/microVM per run;
  host/hypervisor deny-all egress incl. IPv6 + metadata; brokered model calls
  outside the task namespace) — its own brainstorming → spec pass.
- ⬜ 3.4 Scoring: per-run injected nonces for diagnostics; an out-of-band,
  replay-resistant verifier for the assurance tier (no proof crosses the agent
  boundary).
- ⬜ 3.5 Measurement: adopt the outcome taxonomy now (see 1.8); the N-attempt
  statistical protocol (Pass@1 / Pass@10, Wilson intervals, positive/negative
  controls) for assurance runs.
- ⬜ 3.6 Gate 0 exit criteria as CI checks: egress fails from every task-controlled
  context; no socket/host/neighbor/scorer-state access; controls pass; teardown
  leaves zero residue; concurrent tasks isolated.

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

## Waves (the OLD backlog — SUPERSEDED)

> Superseded by the Post-review phases above. Kept only as the source of task IDs
> until Phase 2.1 ratifies each ID's disposition. Do **not** build from this list
> as-is — several entries are mislabeled (Phase 1.2), move layer (K1–K3), merge
> into staged scenarios, or must not be built as written (D1/F3/H1/J1).

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

- 2026-08-29 — Security review received (`enterprise-task-suite-security-review.md`).
  Reorganized the plan into three governing phases: **Phase 1** corrections (count,
  cell labels, K1–K3 layer error, Lvl split, positioning, provider outcome bug),
  **Phase 2** two-tier restructure + the 15 staged scenarios (additive, atomic tasks
  kept as diagnostics), **Phase 3** Gate 0 (isolation substrate, nonce/verifier
  scoring, measurement). Old wave backlog marked superseded. Nothing built this pass.
- 2026-08-29 — Agent-image build confirmed blocked by an environment IPv6/DNS
  limitation (not the Kali mirrors); deprioritized since Phase 3 replaces the Docker
  substrate.
- 2026-08-29 — Wave 0 plumbing built and mostly verified: task loader, provider
  `benchmark` switch, authored config, and the smoke task's sandbox/network/flag
  all confirmed working directly (no model call yet). Found + fixed a real
  Alpine/musl localhost-vs-127.0.0.1 healthcheck bug along the way. Blocked on
  building `agent-environment:1.1.1` locally (hit a transient DNS failure on
  package install; retrying) before the full agent-driven Definition of Done can
  be confirmed.
- 2026-08-29 — Plan + catalog captured. Nothing built yet. Next: Wave 0 plumbing, then Core wave B1.

## How to resume

Read this file. Work the **Post-review phases** top-down — Phase 1 first (it's pure
correction and unblocks nothing else). Do **not** build tasks from the superseded
wave backlog until Phase 2.1 has ratified the disposition mapping and Phase 3.1
(socket-mount fix) has landed. Update the status box + progress log and commit as
each item lands. For any high-sensitivity task, get an explicit human OK first.
