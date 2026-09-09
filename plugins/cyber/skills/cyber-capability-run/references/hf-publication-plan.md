# Step-1 HuggingFace publication plan — GO set only

**Status:** Plan for review (proposal). **No upload happens from any Claude session.**
The build → `docker save` → upload runs on the **x86 VM, navnn-driven**; the HF token
lives on that box, never in a session. This doc + the command set (co-written with the
L3 runner lane) are what navnn executes.
**Date:** 2026-09-09. Gated by [sandbox-license-audit.md](sandbox-license-audit.md);
architecture in [distribution-architecture-rfc.md](distribution-architecture-rfc.md).

## Confirmed decisions (navnn, via L3 Build)

- **Public availability: yes**, intended (benchmarks are already public; our added step
  is prebuilt-image _redistribution_ — the license-gated part).
- **HF repo: `huggingface.co/astroware`** — confirmed, explicit GO for step 1.
- **Agent image: base-pull + thin layer** — pull the official Kali base, add only our
  thin tool layer; do **not** re-host a "Kali"-named image (dodges the trademark; resolves
  the agent-image gate on the CVE-Bench path).
- **Scope: GO set only** — CVE-Bench license-permitted targets + our authored tasks.
  **Never** any of the 40 Cybench images (all NO-GO).
- **Pending:** #3 Cybench (lean: accept build-your-own now, chase permission later) and
  #5 CI ownership/cadence. Neither blocks step 1.

## Two pre-finalize gates (before anything is uploaded)

1. **`hostable = license-GO ∩ builds-cleanly`.** Build cross-check from the CVE-Bench
   live smoke on cyber-x86 (**PARTIAL — build loop still running**):
   - **FAIL so far → NOT hostable until fixed:** CVE-2024-32964 (LobeChat) and
     CVE-2024-32980 (Spin) — **both are license-GO**, so the initial hostable GO set is
     _smaller_ than the license verdict alone; plus CVE-2024-4701 (CONDITIONAL).
   - **Not-yet-failed (pending confirmation):** CVE-2024-4323, -32986, -34359, -5084,
     CVE-synthetic-0.
   - The **Upload?** column below is the license/handling verdict; a target ships only if
     it **also** builds. Final PASS/FAIL to follow from the CVE-Bench session.
   - Each task also builds a small flask evaluator (python:3.x-alpine) — permissive, ships
     with its target.
2. **CAISI Apache-2.0 confirmation** (highest-leverage): one "yes" from CAISI/NIST clears
   the CVE-Bench derivative wrapper, CVE-synthetic-0, and the agent build recipe at once.
   Recommended before finalizing; CVE-synthetic-0 is **held** until it lands.

## Artifact list + handling

Two handling modes, both consistent with base-pull philosophy:

- **Full save+host** — app built from source under a permissive license; `docker save`
  the built image and host the tarball. Re-hosts only permissive software.
- **Base-pull + thin** — target wraps a public vendor image; pull the vendor image from
  Docker Hub at load time and redistribute only the thin (UIUC/CAISI-authored) wrapper.
  Minimizes re-hosting, license surface, and trademark exposure.

| Artifact                                                      | License                                                 | Handling                                                                            | Upload?        | Obligation                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CVE-2024-34359 (llama-cpp-python 0.2.70)                      | MIT                                                     | full save+host                                                                      | ✅ GO          | MIT notice                                                                                                             |
| CVE-2024-32964 (LobeChat v0.150.5)                            | MIT @tag                                                | full save+host                                                                      | ✅ GO          | MIT notice; pin the tag; note npm tree not individually audited                                                        |
| CVE-2024-32980 (Fermyon Spin 2.4.0)                           | Apache-2.0                                              | full save+host                                                                      | ✅ GO          | Apache LICENSE + NOTICE + change notes                                                                                 |
| CVE-2024-32986 (PWAsForFirefox 2.10.0)                        | MPL-2.0                                                 | full save+host                                                                      | ✅ GO          | MPL source availability; no branded Firefox baked at build (confirmed)                                                 |
| CVE-2024-4323 (Fluent Bit 2.0.9)                              | Apache-2.0                                              | **base-pull** `fluent/fluent-bit:2.0.9` + thin wrapper                              | ✅ GO          | Apache attribution; don't re-host the CNCF image                                                                       |
| CVE-2024-4701 (Genie 4.3.0 + Trino 374 + Hadoop 2.7)          | all Apache-2.0                                          | **base-pull** all vendor images + thin wrapper                                      | ⚠ CONDITIONAL  | credit Netflix Genie / Trino / Apache Hadoop; base-pull avoids re-hosting                                              |
| CVE-2024-5084 (WordPress 6.6.1 + Hash Form 1.1.0 + MySQL 8.0) | GPLv2(+)                                                | **base-pull** `wordpress:6.6.1` + `mysql:8.0` + thin wrapper (plugin zip + configs) | ⚠ CONDITIONAL  | GPL source = the plugin zip we ship (satisfied); WordPress/Oracle trademarks rest with the base-pulled official images |
| CVE-synthetic-0 (CAISI-authored)                              | CAISI, no explicit grant                                | full save+host                                                                      | ⛔ HOLD        | needs CAISI Apache-2.0 confirmation; exclude until then                                                                |
| Authored: F2 "Hybrid AD → Cloud Takeover" + defense twin      | promptfoo's own IP                                      | full save+host                                                                      | ✅ GO          | none (ours); python:alpine base                                                                                        |
| Agent image                                                   | Kali base + tools (mostly GPL) + axios MIT + playwright | **base-pull** `kalilinux/kali-last-release` + thin tool layer                       | ✅ GO (recipe) | do NOT re-host a Kali-named image; ship the thin-layer build recipe; credit tools                                      |
| **Any Cybench image**                                         | Sekai NC+AGPL / HTB·Glacier·HKCERT unlicensed           | —                                                                                   | ❌ NEVER       | build-your-own only                                                                                                    |

> **Build overlay (reconciles the Upload? column with build reality).** The ✅/⚠ verdict
> above is the _license/handling_ call; a target ships only if it **also** builds. Per the
> CVE-Bench live smoke (partial): **CVE-2024-32964 (LobeChat) and CVE-2024-32980 (Spin)
> currently FAIL to build** — both license-GO, but **held regardless until the build is
> repaired** — and **CVE-2024-4701** (already CONDITIONAL) fails too. Ship only
> license-GO ∩ build-pass.

## Runner requirements (assurance tier — from the L3 runner lane)

The assurance-tier egress lockdown allows only the model endpoint; **Docker Hub is
blocked**. Two consequences for the pull-not-build flow (both live in the
`run_cybench_x86.sh` lane — the pre-pull-before-lockdown discipline the cybench-3 taught):

1. **Pre-pull before lockdown.** Every base-pull vendor image (`fluent/fluent-bit:2.0.9`;
   `netflixoss/genie-app` + `trinodb/trino` + `harisekhon/hadoop`; `wordpress:6.6.1` +
   `mysql:8.0`) **and** the Kali agent base must be pulled during the **provision phase
   (internet on), BEFORE** the egress lockdown — otherwise they fail at runtime with the
   `docker.io/... i/o timeout` seen in the cybench-3. The default tier (no lockdown) may
   pull at runtime.
2. **Tag-match HF images to compose refs.** A `docker load`ed HF image MUST be tagged to
   match each task's compose `image:` reference, or compose falls back to a Docker Hub
   pull (blocked under lockdown). Extend the CVE-Bench explicit-image-tag verification to
   the docker-load'd HF images.

## Storage mechanism (proposed; final call at command-writing)

- **HF via git-LFS**: `docker save <img> | gzip > <name>.tar.gz`, tracked with LFS in the
  `astroware` repo; users `huggingface-cli download` → `docker load`. Simple, no registry.
- Alternative noted: a GHCR/OCI registry (native `docker pull`). If chosen later, the
  base-pull items don't change.
- Per-image manifest (name → tag → sha256 → source → license) ships in the repo so
  `docker load` results are verifiable.

## Attribution package (ships in the HF repo)

- **`README.md`** — what's stored, how to pull → `docker load`, the per-artifact license
  list, the base-pull steps (vendor images + Kali), and the safety/isolation framing
  (offensive-eval sandboxes; already public upstream; run isolated; default tier is not a
  network boundary — see the RFC).
- **`NOTICE` / `LICENSES/`** — per-artifact provenance (source repo, version, license
  text or link), upstream credits (UIUC cve-bench Apache-2.0; each bundled app), and our
  change notices for the CVE-Bench derivative wrappers.
- **`manifest.json`** — the verifiable image manifest above.

## Execution (navnn runs on the x86 box)

1. On confirmation of scope + build list: L3 runner lane + I co-write the exact
   build/save/upload commands (build the full-save images; pull the base-pull bases; save
   - gzip; `huggingface-cli upload` to `astroware`; push the attribution package).
2. navnn runs them on the x86 VM, HF token in that box's env (never pasted into a session).
3. Verify: on a clean host, `download` → `docker load` (or base-pull) → `promptfoo eval`
   the GO set with no from-scratch target build (Step 4 of the RFC).

## Open items

- CVE-Bench session's build pass/fail list (requested) → finalize `hostable` set.
- Per-CONDITIONAL sign-off from navnn: confirm -4701 and -5084 go up as base-pull+thin
  (recommended), and CVE-synthetic-0 stays held pending CAISI.
- CAISI Apache-2.0 confirmation (recommended before finalizing).
- Storage mechanism final choice (HF-LFS tarballs vs GHCR).

**Nothing has been uploaded. This is the plan for navnn + the runner lane to execute.**
