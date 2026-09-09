# Authored-tasks publication plan — F2 + defense twin → `astroware`

**Status:** active plan (revised 2026-09-09). Scoped to promptfoo's **own authored tasks
only** (F2 "Hybrid AD → Cloud Takeover" + its defense twin). **No third-party benchmark
content is hosted** — Cybench and CVE-Bench are build-your-own (see
[distribution-architecture-rfc.md](distribution-architecture-rfc.md); the _why_ is in
[sandbox-license-audit.md](sandbox-license-audit.md)). Nothing is uploaded from any Claude
session: the build → `docker save` → upload runs on the **x86 VM, navnn-driven**, HF token
on that box; the command set is co-written with the L3 runner lane.

> _History: an earlier version of this file planned hosting a curated CVE-Bench set. That
> was dropped when navnn chose build-your-own for all third-party benchmarks. The only
> thing hosted is promptfoo's own authored tasks, below._

## Decision (navnn, 2026-09-09)

- **Authored tasks (F2 + defense twin): HOSTED prebuilt on `huggingface.co/astroware`**,
  pull-and-run — the flagship is what James tries, so it should be as smooth as possible.
- **Third-party benchmarks: host nothing** (build-your-own). Unchanged and intact.

## Bake-audit gate (must pass before an authored image is uploaded)

The task _design_ is promptfoo's IP (clean), but a hosted _image_ must not bake in
non-redistributable third-party content (the lens that held the CVE synthetic target's
branded Firefox). Status:

- **F2 offense — PASSED (two independent audits concur, this session + the L3 lane).**
  - All 9 services are identical: `FROM python:3.12-alpine` → `COPY app.py` → run. No
    `pip`/`apk`/`wget`/`curl`/`apt`/`git-clone`, no requirements file, no bundled binaries
    or OS images. `app.py` imports are **stdlib-only** (`http.server`, `base64`, `hashlib`,
    `hmac`, `json`, `os`, `urllib`).
  - ⇒ each image = redistributable base (official `python:3.12-alpine`; PSF Python +
    Alpine/musl) + promptfoo's own code. The AD/LDAP/IdP estate is a **pure-Python
    simulation**; `*.corp.internal` are network aliases. No Windows, Samba, or MS images.
  - **Contamination-safe:** each service's build context is its own subdir (`./portal`,
    `./directory`, …), so the task-root `solution/`, `gen.py`, `validate.py` sit **outside
    every build context** and cannot be baked in; per-run nonces (`PFCYBER_NONCE_*`) are
    runtime env vars, not baked. A hosted F2 image carries **no flag, oracle, or
    walkthrough**.
- **Defense twin — PENDING its own bake-audit** (it lives in the defense lane; SP1 still
  in design). F2's clearance does **not** transfer. If its images don't exist yet, audit
  at build time, same stdlib/base-only + contamination lens, before its upload.

## What is hosted (scope)

| Artifact | What | Host? | Note |
| --- | --- | --- | --- |
| F2 service images (9) | `idp, portal, ci, cloudapp, directory, deployment, cloudiam, monitoring, backup` — each `python:3.12-alpine` + `app.py` | ✅ HOST (F2 audit passed) | `docker save` + host; pin the base to a digest |
| Defense-twin images | (SP1, TBD) | ⏳ after its bake-audit | audit at build time; don't upload until clear |
| Shared agent image | Kali base + thin tool layer | ❌ NOT hosted | base-pull `kalilinux/kali-last-release` + thin-build (trademark) — referenced via `image:`, pulled not hosted |
| Any Cybench / CVE-Bench image | third-party | ❌ NEVER | build-your-own; host nothing |

## Pull-and-run flow (for James) — honest about the one build step

1. `huggingface-cli download` the 9 F2 image tarballs from `astroware` → `docker load`.
2. **Tag-match:** each loaded image MUST be tagged to the task's compose `image:` ref, or
   compose falls back to a Docker Hub pull.
3. The shared agent is **not** hosted: base-pull the official Kali image + thin-build the
   agent layer (one fast build; avoids re-hosting a "Kali"-named image). **So F2 is
   pull-and-run for the estate, but the agent is still a small local build — not literally
   zero-build.**
4. `promptfoo eval` the F2 config. No from-scratch estate build, no `sudo` (default tier).

## Upload procedure (co-written with the runner lane; navnn runs on the VM)

1. Build the 9 F2 images (`docker compose build`, from each service subdir).
2. `docker save <img> | gzip > <name>.tar.gz` for each; generate a `manifest.json`
   (name → compose `image:` ref → sha256).
3. `huggingface-cli upload` the tarballs + manifest + README to `astroware` (git-LFS).
   HF token in the VM's env — **never pasted into a session**.
4. Verify on a clean host: `download` → `docker load` → tag-match → base-pull+thin agent →
   `promptfoo eval` F2 with no estate rebuild.

## Attribution package (ships in the `astroware` repo)

Minimal — the content is promptfoo's own IP; nothing third-party is baked:

- **`README.md`** — what's stored, the pull → `docker load` → tag-match → run flow, the
  agent base-pull+thin step (and the honest "not zero-build" note), and the
  safety/isolation framing (offensive-eval task; run isolated; default tier is not a
  network boundary — see the RFC).
- **Base-image credit** — official `python:3.12-alpine` (PSF / Alpine). No third-party
  NOTICE/LICENSES needed beyond that, because nothing else is baked.
- **`manifest.json`** — the verifiable image manifest.

## Open items

- Defense-twin bake-audit (defense lane) before its upload.
- Digest-pin `python:3.12-alpine` for reproducible hosted images.
- Co-write the exact build/save/upload command set with the L3 runner lane when navnn is
  ready to run it on the VM.

**Nothing has been uploaded. `astroware` will hold only promptfoo's own authored task
images — never third-party benchmark content.**
