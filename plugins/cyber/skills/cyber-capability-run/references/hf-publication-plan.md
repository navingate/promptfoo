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

- **Authored tasks: HOSTED on `huggingface.co/astroware`** — F2 as **prebuilt images**
  (pull-and-run; the flagship James tries, so it should be as smooth as possible), and the
  defense twin as a **server-side scorer** over a private corpus (brief + eval code
  published; corpus held private and scored server-side — no images, no corpus download;
  see below). Only promptfoo's own IP.
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
- **Defense twin — CONFIRMED (cyber-defense lane). Different shape: NO Docker images, and
  NOT a downloadable corpus.** It's a corpus/code eval (detect/triage/patch), so there is
  nothing to bake-audit or build, and no agent image.
  - **Provenance = CLEAN:** the corpus is own-authored/synthetic — de-oracled shapings of
    our own F2 estate (`gen.py`), authored benign incidents (`benign_incidents.py`), and
    `corpus_gen.py` synthetic. No real product logs, copied writeups, or branded data →
    safe to distribute.
  - **Ship / withhold:** SHIP (model-visible, own IP) = `threat.md` (the brief) + the
    harness/eval code + the DISCLOSED `soc_config` keys (the `self_service_attrs` pool; the
    `honored_tag` VALUE stays withheld, referenced as `{"$config":"honored_tag"}`).
    WITHHOLD (host-side, answer keys) = `grounded*/bundle-*.json`, `ground_truth.json`,
    `fixtures/correct*.json`. (Telemetry is de-oracled by a tripwire, so a telemetry leak
    isn't a live oracle — but the labels + reference rules are, hence withheld.)
  - **Distribution model (differs from F2):** the corpus is STATIC (not per-run
    regenerated), so publishing it as a downloadable dataset would be **oracular**. So the
    defense twin is hosted as a **SERVER-SIDE stdlib scorer**, not a pull-and-run artifact:
    expose the brief + a model interface; the model submits a detection rule; score it
    server-side against the **private held-out corpus**. Zero Docker.

## What is hosted (scope)

| Artifact | What | Host? | Note |
| --- | --- | --- | --- |
| F2 service images (9) | `idp, portal, ci, cloudapp, directory, deployment, cloudiam, monitoring, backup` — each `python:3.12-alpine` + `app.py` | ✅ HOST (F2 audit passed) | `docker save` + host; pin the base to a digest |
| Defense-twin (server-side scorer) | brief (`threat.md`) + eval code + disclosed `soc_config`; **no images, no agent** | ✅ provenance + contamination CONFIRMED | score server-side over the PRIVATE corpus; **never publish** `grounded*/`, `ground_truth.json`, `fixtures/correct*` |
| Shared agent image | Kali base + thin tool layer | ❌ NOT hosted | base-pull `kalilinux/kali-last-release` + thin-build (trademark) — referenced via `image:`, pulled not hosted |
| Any Cybench / CVE-Bench image | third-party | ❌ NEVER | build-your-own; host nothing |

## Pull-and-run flow (for James) — honest about the one build step

1. `SUITE=authored PULL_F2=1` (runner lane): `huggingface-cli download` the 9 F2 tarballs
   from `astroware` → `docker load`.
2. **Tag-match (Option A):** the F2 compose services carry stable `image: astroware/f2-<svc>:v1`
   tags alongside their `build:`, so `docker compose up` uses the loaded images and only
   falls back to building if one is absent. No fragile project-name dependency.
3. The shared agent is **not** hosted: base-pull the official Kali image + thin-build the
   agent layer (one fast build; avoids re-hosting a "Kali"-named image). **So F2 is
   pull-and-run for the estate, but the agent is still a small local build — not literally
   zero-build.**
4. `promptfoo eval` the F2 config. No from-scratch estate build, no `sudo` (default tier).

## Upload procedure — `scripts/publish_f2_hf.sh` (navnn runs on the VM)

Concrete runbook (Option A tag scheme `astroware/f2-<service>:v1`, 9 services). navnn runs
on the x86 VM with `HF_TOKEN` in the env (never pasted into a session):

```bash
export HF_TOKEN=hf_...          # WRITE token for astroware; stays on the box
bash scripts/publish_f2_hf.sh   # build (stable tags) → docker save+gzip ×9 → manifest.json → hf upload
```

The script: `docker compose build` (the compose `image:` tags apply `astroware/f2-<svc>:v1`)
→ `docker save | gzip` each of the 9 → `manifest.json` (service → tag → image id → tarball
sha256) → copies the README → `huggingface-cli upload astroware/f2`. Syntax-checked +
flow/manifest self-tested with Docker/HF stubbed; the real build/save/upload run on the VM.
Depends on: the F2 compose carrying the `image:` tags (Option A — F2 lane).

Verify on a clean host afterward: `SUITE=authored PULL_F2=1` → download → `docker load` →
base-pull + thin-build the agent → `promptfoo eval` F2 with **no estate rebuild**.

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

- Defense-twin: provenance + contamination **CONFIRMED** (cyber-defense). Remaining = stand
  up the server-side scorer (publish brief + model interface; keep the corpus private,
  withhold the answer keys) — future, navnn-run.
- Digest-pin `python:3.12-alpine` for reproducible hosted images.
- Co-write the exact build/save/upload command set with the L3 runner lane when navnn is
  ready to run it on the VM.

**Nothing has been uploaded. `astroware` will hold only promptfoo's own authored task
images — never third-party benchmark content.**
