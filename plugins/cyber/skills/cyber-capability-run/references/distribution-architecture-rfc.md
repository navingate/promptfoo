# RFC: "Run like butter" — open-source distribution architecture for the promptfoo cyber-eval plugin

**Status:** Proposal (RFC) for navnn's review — not code changes.
**Date:** 2026-09-09.
**Scope:** How every promptfoo customer runs the cyber-eval sandboxes with minimal
friction. The license/hosting audit ([sandbox-license-audit.md](sandbox-license-audit.md))
is the **gating** foundation and is summarized in §7.
**Inputs:** analysis from the offense/L3 runner session (session-f8f158) + this
session's license audit. Any actual edits to shared runner files are out of scope here
and must be coordinated with their owners (see §12).

> **DECISION RECORD — 2026-09-09 (navnn, via the L3 Build session; supersedes the earlier
> "publish to `astroware`" direction): BUILD-YOUR-OWN for BOTH Cybench and CVE-Bench; host
> NO prebuilt benchmark images anywhere.** This is license-clean — build-your-own is _use_,
> not redistribution: promptfoo hosts nothing third-party; users build locally from the
> upstream clone. **Win A below (a public prebuilt-image store) is DROPPED** and replaced
> by _build-your-own + a maintained central build-recipe_ (CI-pinned / `PATCH_ROT`-
> equivalent Dockerfiles) that makes local builds reliable without hosting anything.
> **Win B (the no-`sudo` Inspect-sandbox default), the tiered UX, and the SUT front-door
> all stand.** The license audit ([sandbox-license-audit.md](sandbox-license-audit.md)) is
> retained as the **record of why** build-your-own was chosen. **Authored tasks
> (F2/defense) are the ONE exception: HOSTED prebuilt on `astroware`, pull-and-run
> (navnn, 2026-09-09)** — they are promptfoo's own IP with no third-party license barrier
> (F2 bake-audit passed; defense-twin audit pending). Only promptfoo's own tasks are
> hosted — **never** third-party benchmark content. Sections below that describe hosting
> _third-party_ are historical context; §5.1, §5.6, §7, §9, §10 carry the update.

---

## 1. Summary

Make the cyber-eval plugin "run like butter": a user with a Docker host runs one
command and gets a working eval — **no cold builds, no host-level `sudo`/`iptables`,
no bespoke VM scripts**. We get there with two independent wins:

- **A) ~~Pull, don't build~~ → Build-your-own, made reliable.** _(revised — see decision
  record.)_ We host **no** prebuilt benchmark images. Instead, users build locally from
  the upstream clone, and a **maintained central build-recipe** (CI-pinned /
  `PATCH_ROT`-equivalent Dockerfiles) fixes apt-rot **once, centrally** so those local
  builds are reliable. This keeps the whole thing license-clean (use, not redistribution).
- **B) A lighter default execution model.** Make the default run use **Inspect's
  per-task Docker sandbox** (container isolation, no host changes). Demote today's
  host-level egress lockdown to an **opt-in "assurance mode."**

Both help **everyone**: Win B removes the `sudo`/`iptables` cold-start pain for every
run; the maintained build-recipe makes build-your-own reliable for every benchmark.
promptfoo stays the control surface and system of record; it hosts nothing third-party
and never hosts offensive agents (self-hosted throughout).

---

## 2. Problem statement (today's friction — grounded in current code)

| Friction                                        | Where it lives today                                                                                                                                                | Effect                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold, from-scratch build of ~40 target images   | `setup_caisi.sh` + `ucb build`; `run_cybench_x86.sh` (build phase)                                                                                                  | Slow, fragile; several tasks pin EOL Debian and can't `apt update` (apt-rot). A `PATCH_ROT=1` hack repoints them at `archive.debian.org` — a per-user workaround. |
| Host-level egress lockdown as the flagship path | `run_cybench_x86.sh` → `egress-lockdown.sh` (needs `sudo`, `iptables` OUTPUT + DOCKER-USER, IPv6 drop, IMDS drop, model-IP pin) + `egress-selftest.sh` (hard proof) | Requires a dedicated x86 Linux VM with root; generated most of the recent cold-start pain. Overkill for a first run.                                              |
| Bespoke, VM-specific deploy scripts             | `deploy/run_cybench_x86.sh` (32 KB), Gate-0B microVM tooling                                                                                                        | High skill floor; not a coherent "install the plugin and go" experience.                                                                                          |
| No public image source                          | CAISI ships no registry (README: "bring your own"); `UCB_REGISTRY` points at the user's own registry                                                                | Every user must build or stand up their own registry.                                                                                                             |
| Resource floor                                  | Docker + several GB + hours for a full run                                                                                                                          | Can't be as light as an API-only eval (inherent, not a bug).                                                                                                      |

There already **is** a simpler path — `scripts/run_cybench.sh` runs the 3-task slice
with **no egress lockdown**, relying on the per-task Docker sandbox. This RFC promotes
that shape to the default and productizes it.

---

## 3. Goals / non-goals

**Goals**

- One-command default run on any Docker host (laptop included, via the arm64 dev path).
- Eliminate cold-build friction for every benchmark image (via the maintained recipe).
- Remove `sudo`/`iptables` from the default; keep a rigorous mode for assurance runs.
- Keep promptfoo as orchestration + reporting + system of record; keep offense
  self-hosted.
- Handle apt-rot **once, centrally** (CI) rather than per-user.

**Non-goals**

- Promptfoo hosting or running offensive agents/targets for users (always self-hosted).
- Turning assurance-grade isolation off — it becomes opt-in, not gone.
- Relicensing or redistributing anything the audit marks NO-GO (§7).
- Shipping code in this document (proposal only).

---

## 4. Core principles

1. **Build-your-own, made reliable.** Users build locally from the upstream clone; a
   maintained central build-recipe (pinned Dockerfiles) keeps that reliable. promptfoo
   hosts **no** third-party images — build-your-own is use, not redistribution.
2. **Self-hosted.** Promptfoo is the control surface + system of record; the user's own
   Docker host runs the sandboxes and the model calls. Promptfoo never hosts the
   offensive agents or targets.
3. **Lean on Inspect.** Use Inspect / `inspect_cyber` for task definitions and per-task
   Docker sandboxing (each task already ships a `compose.yml`). Don't reinvent isolation.
4. **Tiered UX.** Make the easy thing easy and the rigorous thing available: Quickstart
   → Full → Assurance.
5. **Isolation is the safety story — but it is tiered, and the tiers differ.** These are
   offensive-eval sandboxes (vulnerable targets + exploits); they are already public
   upstream and we host nothing (users build locally), so this adds no new disclosure. The
   default tier isolates process + filesystem but **does not** contain the agent's
   network; the enforced network boundary exists only in assurance mode (§5.2). Users
   running an untrusted/offensive model must pick the tier that matches the risk.

---

## 5. Proposed architecture

```
                promptfoo (control surface + system of record)
                 │  promptfoo eval  →  promptfoo view (model comparison)
                 ▼
   provider.py  ──►  Inspect / inspect_cyber  ──►  per-task Docker sandbox (compose.yml)
     │  SUT registry (CYBER_SUT_ENDPOINT + CYBER_MODEL, one key)          │
     │                                                                    ▼
     │                                            BUILD locally from the upstream clone
     ▼                                              (maintained build-recipe; host nothing)
   any OpenAI-compatible model endpoint
```

### 5.1 Build-your-own + a maintained central build-recipe _(win A, revised)_

**No public image store; promptfoo hosts nothing.** Users build the benchmark images
locally from the upstream clone (`setup_caisi.sh` + `ucb build`, or the per-task
`compose.yml`). What makes this reliable — instead of the fragile cold build that fails
on EOL-Debian apt-rot — is a **maintained central build-recipe**: CI-pinned /
`PATCH_ROT`-equivalent Dockerfiles (seeded by the existing `scripts/patch_rot.sh`) that
repoint rotted bases at archives and pin fetched artifacts, so a fresh `build` succeeds.
The recipe is versioned in-repo and refreshed by CI (§5.6). This keeps the whole flow
license-clean (build-your-own = use, not redistribution) — see the decision record and §7.

### 5.2 THE BIG UX UNLOCK: default = Inspect per-task Docker sandbox _(win B)_

- **Default:** Inspect's per-task Docker sandbox. Requirement: a Docker host +
  `promptfoo eval`. **No host mutation, no `sudo`, no `iptables`.**
- **Assurance (opt-in):** today's `run_cybench_x86.sh` host-level egress lockdown
  (`egress-lockdown.sh` + `egress-selftest.sh`), plus the Gate-0B layer (§5.4).
  Explicitly for cross-check/assurance verdicts on a dedicated x86 VM.
- This split is the single biggest cold-start-pain reduction: the sudo/iptables/self-test
  boundary moves off the default path.

> **⚠ Honest containment caveat — the default is NOT a network boundary.** The default
> tier gives **process/filesystem isolation only**; network containment is whatever each
> task's `compose.yml` sets, and the agent's tool-execution sandbox is generally **not
> egress-restricted**. So in the default tier an offensive/untrusted agent **can reach
> the internet.** The enforced network boundary lives **only** in assurance mode: the
> host lockdown restricts both host `OUTPUT` **and** container-originated traffic (via the
> Docker `DOCKER-USER`/FORWARD chain) to the model endpoint IP:port only — lo +
> ESTABLISHED + Docker bridge subnets allowed, IMDS/link-local (169.254.0.0/16) dropped,
> IPv6 fully off, model IP pinned in `/etc/hosts` (no runtime DNS), and a hard
> `egress-selftest.sh` gate before any task. **For a benchmark of _offensive_ agents this
> is safety-relevant, not cosmetic** — users running an untrusted model must choose the
> assurance tier (or add per-task network restrictions), and the tier docs (§5.4) and UX
> must say so plainly. Frame it as: **default = convenient, weaker network containment;
> assurance = the actual network boundary.**

### 5.3 Division of labor

- **Inspect / `inspect_cyber` / `inspect_evals`:** task definitions + sandboxing.
- **promptfoo:** orchestration, `promptfoo view` model comparison, the SUT registry, and
  **owns the authored tasks** (F2 "Hybrid AD → Cloud Takeover" + its defense twin — see
  §7: fully redistributable, promptfoo's own IP).

### 5.4 Tiered UX

| Tier           | Host                                                                               | Images                                                                                                                        | Isolation                                                                                                    | For                                 |
| -------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **Quickstart** | any Docker host incl. laptop (arm64), via the `BUILD_AGENT_IMAGE=0` stand-in agent | **authored tasks (F2/defense)** on the stand-in agent; the Cybench 3-task slice needs an **x86** host for the real Kali agent | process/fs only — **network NOT egress-restricted**                                                          | first run / demo / model spot-check |
| **Full**       | **x86** Docker host (real Kali agent + full targets)                               | build the full set (maintained recipe)                                                                                        | process/fs only — **network NOT egress-restricted**                                                          | full-suite comparison               |
| **Assurance**  | dedicated x86 VM                                                                   | build during provision (before lockdown)                                                                                      | **enforced network boundary** (host egress lockdown) + Gate-0B (nonce/verifier/stats; microVM = design goal) | cross-check / assurance verdicts    |

**Gate-0B (assurance) — grounded** (`deploy/gate0b/` + `references/`): (1) per-run,
per-stage **nonces minted out-of-band** by `nonce_broker.py` so the flag is not baked
into the image (contamination-proof, must-capture-live); (2) an **out-of-band verifier**
(`selftest_gate0b_verifier.py`, `references/gate-0b-verifier.md`) checking the submission
against the nonce, not a gameable in-image string; (3) **N-attempt pass@k stats**
(`gate0b_host_run.sh --repeat`, aggregated by `gate0b_report.cjs`); (4) CI
(`ci_gate0b.py`) + host runbook. Gate-0B stacks **on top of** the egress lockdown.
**microVM-per-run** (fresh disposable VM per run vs. shared-kernel Docker) is the
design's stronger-isolation goal — **not yet implemented**: today's x86 runner is Docker
plus the host egress lockdown, explicitly stamped "baseline/cross-check grade, NOT
Gate-0B assurance."

### 5.5 Simple model config _(already built)_

`CYBER_SUT_ENDPOINT=<engy|chutes|azure|openai|anthropic|…>` + `CYBER_MODEL=<id>` + one
key, resolved from `provider.py`'s `SUT_ENDPOINTS` — any OpenAI-compatible endpoint.
Both runners already honor this uniform interface. No new work; document it as the front
door.

### 5.6 CI that maintains the central build-recipe _(now the PRIMARY deliverable)_

With hosting dropped, this is the core of Win A. A scheduled CI job maintains a
**pinned, build-verified recipe for BOTH benchmarks** — Cybench and CVE-Bench — so a
user's local `build` succeeds without per-user apt-rot firefighting. It **publishes no
images**; it publishes reliable **build instructions**:

- A `PATCH_ROT`-equivalent pinned-Dockerfile set (seeded by `scripts/patch_rot.sh`) that
  repoints EOL-Debian bases at `archive.debian.org` and pins fetched artifacts
  (e.g. the base-pull vendor images, and source downloads like the LobeChat release zip
  or the Fermyon Spin installer that otherwise 404).
- CI periodically runs the full `build` on a clean host and fails when a target rots,
  so the recipe is fixed centrally, once — before users hit it.
- Empirically motivated: a fresh CVE-Bench smoke already shows 3 of 8 targets failing to
  build (LobeChat, Spin, Genie); that is exactly the rot this recipe exists to absorb.

Cadence + ownership are a maintenance cost (§8) and the main open decision (§10).

---

## 6. User experience (target)

```bash
# Quickstart — any Docker host:
export CYBER_SUT_ENDPOINT=openai CYBER_MODEL=gpt-5 OPENAI_API_KEY=...
promptfoo eval -c plugins/cyber/.../promptfooconfig.yaml     # builds the slice (recipe), runs, no sudo
promptfoo view                                               # model comparison
```

No VM, no root, no `sudo` in the default tier. It **does** build the images locally —
that's the build-your-own model — but the maintained recipe (§5.6) makes that reliable
instead of the old apt-rot lottery. Two honest caveats: (a) the first full build still
costs time + several GB (§8 resource floor); (b) the **first run also clones the CAISI
harness and installs its Python deps** (`setup_caisi.sh` → `git clone` then `uv sync`),
because `provider.py` imports `inspect_ai` and `ucb` — a one-time, network-required step. Whether we may _vendor_ (ship) the harness code to remove even that clone is
the same CAISI-confirmation gate as audit open item 1 (§7). Assurance mode is a
documented opt-in flag/runner for users who need an enforced egress boundary and
assurance-grade stats.

---

## 7. Licensing — the gating section

Full analysis: **[sandbox-license-audit.md](sandbox-license-audit.md)**. With hosting
dropped, this section is no longer a gate on an upload — it is the **record of _why_ we
chose build-your-own**: it enumerates the redistribution constraints that made hosting
not worth it. Verdict summary (retained as that record):

| Bucket                                       | Count | Verdict                                                                                                                                 | Consequence for the public store                                                                                                                                                                                 |
| -------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cybench challenge images                     | 40    | **NO-GO** — SekaiCTF (12) is CC BY-**NC**-SA + AGPL; HackTheBox (17), Glacier (9), HKCERT (2) ship **no license** (all rights reserved) | **Cannot** host publicly. These stay build-locally or bring-your-own-private-registry, unless per-competition permission is obtained.                                                                            |
| CVE-Bench targets                            | 8     | **5 GO** (MIT/Apache/MPL) / **3 CONDITIONAL** (GPL + trademarks; multi-image; the CAISI-authored synthetic)                             | Host the GO set with attribution; pull vendor app-images (WordPress/MySQL/Trino/Hadoop/Genie) from their existing public homes rather than re-hosting.                                                           |
| Agent image (Kali-based)                     | 1     | **CONDITIONAL** — Kali is a trademark                                                                                                   | Prefer pulling the Kali base + a thin tool layer, or re-host under a non-Kali name + disclaimer. **Gates the CVE-Bench path** (every CVE `compose.yml` references `agent-environment:1.1.1`).                    |
| promptfoo-authored tasks (F2 + defense twin) | —     | **GO** — promptfoo's own IP                                                                                                             | Host freely.                                                                                                                                                                                                     |
| CAISI harness code (`inspect_ai` + `ucb`)    | —     | **unlicensed** — avoid redistributing                                                                                                   | Not hosted as an image. Consequence: even in pull-mode the first run still `git clone`s CAISI + `uv sync` (§6). Whether we may _vendor_ it to skip the clone is the same CAISI-confirmation gate as open item 1. |

**Consequence under build-your-own:** because promptfoo hosts nothing, **none of these
redistribution constraints bite** — building and running locally is _use_, not
distribution, so even the Cybench NO-GO images and the unlicensed CAISI harness are fine
for a user to build and run. The table stays as the record of why hosting was rejected.
Value now flows through the maintained build-recipe (§5.6), which must cover the same
targets the audit lists. _(If hosting were ever revisited, every constraint above
reopens, and a single Apache-2.0 confirmation from CAISI would be the highest-leverage
unlock — for the CVE-Bench wrappers, the synthetic target, and the agent recipe.)_

---

## 8. Trade-offs (stated honestly)

- **Maintenance burden.** Central CI rebuild/pin needs an owner and a cadence; stale
  pins reintroduce apt-rot; new upstream tasks need onboarding + a license check.
- **Licensing.** Resolved by build-your-own: hosting nothing means **no redistribution
  exposure at all** (§7). The residual is upstream — a user obtains benchmark content
  under its own terms by cloning, exactly as they do to run the benchmark today.
- **Dual-use / security.** These are offensive-eval sandboxes. Mitigations: the
  benchmarks are already public upstream and **we host nothing** (users build locally —
  no new disclosure); self-hosted (promptfoo never runs the agents). **Isolation is the
  safety story, but be
  honest that it is tiered:** the default tier does **not** network-contain the agent, so
  an untrusted/offensive model can reach the internet in it; the enforced egress boundary
  is assurance-only (§5.2). The docs/UX must state each tier's containment level so users
  match the tier to the risk. navnn should confirm public availability is intended.
- **Resource floor.** Docker + several GB + hours for a full run. Quickstart shrinks it
  (3-task slice, laptop-capable) but it will never be as light as an API-only eval.
- **Productization work.** Today's bespoke VM scripts → a coherent, tiered plugin: real
  engineering (default/assurance split, the maintained build-recipe + its CI, tiered
  docs). No upload/pull pipeline to build — one fewer moving part than the hosting plan.

---

## 9. Migration path

No hosting/upload step exists any more. Each step is independently shippable.

1. **Stand up the maintained build-recipe** (§5.6) — the Win-A replacement: pin the
   rotted Dockerfiles + source fetches for **both** benchmarks; add CI that runs the full
   `build` on a clean host and fails on rot. (Coordinate with the CVE-Bench + runner
   lanes; seed from `scripts/patch_rot.sh`.)
2. **Split default vs. assurance:** default = Inspect per-task sandbox (no host lockdown);
   assurance = opt-in egress lockdown + Gate-0B, with the provision-phase build/pre-pull
   **before** lockdown. (Coordinate with the offense/L3 runner lane.)
3. **Tiered docs:** Quickstart / Full / Assurance, with the simple model-config front door.
4. **Verify** a clean-host build-and-run of the whole suite via the recipe (no apt-rot).

---

## 10. Open questions / decisions for navnn

**Resolved (2026-09-09):** third-party benchmarks (Cybench + CVE-Bench) = build-your-own,
**host nothing** (so Cybench-permission and third-party HF hosting are moot). Authored
tasks (F2 + defense twin) = **HOSTED on `astroware`**, pull-and-run — the one thing
hosted, and only because it is promptfoo's own IP. Shared agent image =
base-pull(Kali)+thin, referenced not hosted. See
[hf-publication-plan.md](hf-publication-plan.md) for the authored publication plan.

Remaining:

1. **Recipe/CI ownership + cadence:** who maintains the third-party build-recipe, and how
   often does CI run the clean-host build? (The one real ongoing cost.)
2. **Defense-twin bake-audit:** before the defense twin is hosted it needs the same
   image-content audit F2 passed (defense lane; SP1 in design). F2 is cleared; the twin is
   not — don't upload it until its audit clears.

## 11. What we are NOT proposing to change silently

Assurance-grade isolation, the SUT registry interface, and the authored-task IP model
are preserved. The egress lockdown is demoted, not deleted.

## 12. Coordination (shared files — proposal only, no edits here)

- `run_cybench_x86.sh` egress/runner mechanism + `egress-lockdown.sh` /
  `egress-selftest.sh` + the default/assurance split → the **offense/L3 runner lane**
  (L3 Build session `local_d67853e0` / session-f8f158). They confirmed ownership of
  SUT-registry resolution, IPv4 getaddrinfo, the setup_caisi temp-creds carrier, the
  `/etc/hosts` scrub-before-resolve, and the egress-lockdown invocation. Coordinate with
  them before implementing §5.2/step 3.
- `provider.py` / SUT registry → **F2 Chain session (local_461548ac)**.
- CVE-Bench wiring → **CVE-Bench session (local_77493580)**.
- `setup_caisi.sh` / `run_cybench*.sh` shared edits → coordinate with the above.

This RFC proposes direction; implementation edits to those files happen in their owners'
lanes.
