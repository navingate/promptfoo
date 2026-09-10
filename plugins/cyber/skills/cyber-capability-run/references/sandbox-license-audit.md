# Cyber-eval sandbox redistribution — license audit (Step 1)

> **Outcome (2026-09-09):** this audit drove the decision to **build-your-own for both
> benchmarks and host nothing** — the redistribution constraints below (Cybench NO-GO;
> CVE-Bench mixed; CAISI/agent conditions) made hosting not worth it. The audit is kept as
> the **record of why**. It remains accurate; it is simply no longer a gate on an upload.
> Live direction: [distribution-architecture-rfc.md](distribution-architecture-rfc.md).

**Purpose.** Determine whether the prebuilt cyber-eval sandbox images/assets may be
**saved and redistributed** (so users PULL prebuilt images instead of building ~40
Docker targets from scratch). This is the gating audit; **no upload has been
performed**. Step 2 (host on HuggingFace) is blocked until (a) licensing confirms it
is permitted AND (b) navnn confirms the exact HF repo and gives an explicit go.

**Audited on:** 2026-09-09. Sources shallow-cloned to scratch and read directly;
repo-level licenses confirmed via the GitHub API (`gh api repos/<owner>/<repo>`).

**Method.** Two layers, per the goal:

1. Benchmark/harness licenses (task defs, evaluators, harness code).
2. Third-party software bundled inside each built target image (the harder half).
   Conservative rule applied throughout: **unclear or unlicensed → NO-GO** (do not
   redistribute; flag it).

---

## Scope: what "the sandboxes" are

Vendored (gitignored) clone of `usnistgov/caisi-cyber-evals` under
`scripts/vendor/caisi-cyber-evals/`, from which `ucb build` builds Docker images:

| Set                                         | Count                                                                                                                            | Built from                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Cybench target images                       | 40 tasks (~25 build a `target` image per `compose.yml`; rest use an alpine stub / no build — but all 40 carry challenge content) | `src/ucb/benchmarks/cybench/<task>/`  |
| CVE-Bench target/evaluator images           | 8 CVEs                                                                                                                           | `src/ucb/benchmarks/cve-bench/CVE-*/` |
| CAISI agent image                           | 1 (Kali-based, heavy)                                                                                                            | `src/ucb/containers/agent/Dockerfile` |
| promptfoo-authored tasks (F2, defense twin) | promptfoo's own                                                                                                                  | `plugins/cyber/.../tasks/`            |

**Not audited (not built by the plugin, out of scope):** `src/ucb/containers/gaas`
(Ghidra service), `src/ucb/containers/pwn_college`, and `src/ucb/benchmarks/test`.

---

## Layer 1 — benchmark / harness licenses

| Component                                    | GitHub-detected license                                                 | Notes                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usnistgov/caisi-cyber-evals` (harness code) | **none** (null; no top-level LICENSE; no `license` in `pyproject.toml`) | Authors are NIST employees (…@nist.gov). US-government works are likely public domain in the US (17 USC §105) but **no explicit grant**, contractor contributions possible, and §105 gives no international public-domain status. Harness _code_ is **not** baked into target images. |
| `andyzorigin/cybench` (framework)            | **Apache-2.0**                                                          | Covers the cybench runner/agent/grading code **only** — NOT the third-party challenge content under `benchmark/<competition>/`.                                                                                                                                                       |
| `uiuc-kang-lab/cve-bench` (framework)        | **Apache-2.0** © UIUC Kang Lab                                          | Clean. CAISI re-packaged the tasks into its own layout (upstream uses `src/critical/challenges/…`); CAISI's subtree carries the UIUC Apache-2.0 LICENSE and is a redistributable derivative (attribution + change-notice obligations).                                                |

> **The reading the CVE-Bench GO path rests on.** The built CVE-Bench images contain
> CAISI-authored files (adapted `Dockerfile`s, `evaluator.py`, `run.py`, `server.py`).
> CAISI placed UIUC's Apache-2.0 LICENSE in the subtree and attached **no separate or
> different terms** to its modifications; under Apache-2.0 §4 those modifications are
> most reasonably read as licensed under that same LICENSE, and are therefore
> redistributable with attribution + change notices. This is a reasonable reading, not
> a certainty — a **single confirmation from CAISI** (see open item 1) removes the
> ambiguity for all 8 CVE targets, CVE-synthetic-0, and the agent build recipe at once.

### Cybench challenge content — governed by each source competition (NOT by cybench's Apache-2.0)

Cybench's top-level Apache-2.0 header has a **placeholder copyright** ("[name of
copyright owner]") and cannot relicense content its authors do not own. Only SekaiCTF
attached license files in the tree; the others attached none.

| Source competition               | CAISI tasks                                                                                                                                                                                                                              | Count | License                                                                                    | Verdict                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SekaiCTF 2022+2023               | diffecient, robust_cbc, ezmaze, failproof, noisier_crc, noisy_crc, randsubware, chunky, frog_waf, network_tools, just_another_pickle_jail, eval_me                                                                                       | 12    | **AGPL-3.0 (code) + CC BY-NC-SA 4.0 (content)**                                            | **NO-GO** for commercial redistribution — CC **NonCommercial** forbids commercial-advantage use; ShareAlike + AGPL network-copyleft add heavy obligations. |
| HackTheBox Cyber Apocalypse 2024 | primary_knowledge, partial_tenacity, dynastic, it_has_begun, urgent, were_pickle_phreaks_revenge, delulu, packedaway, crushing, flecks_of_gold, data_siege, labyrinth_linguist, lootstash, permuted, flag_command, unbreakable, locktalk | 17    | **none** (repo archived, license null)                                                     | **NO-GO** — all rights reserved by HTB.                                                                                                                    |
| Glacier CTF 2023 (LosFuzzys)     | missingbits, slcg, walking_to_the_sea_side, shuffled_aes, skilift, avatar, rpgo, sop, glacier_exchange                                                                                                                                   | 9     | **none**                                                                                   | **NO-GO** — all rights reserved.                                                                                                                           |
| HKCERT CTF                       | motp, back_to_the_past                                                                                                                                                                                                                   | 2     | **none** (`hkcert-ctf/CTF-Challenges` and `blackb6a/hkcert-ctf-2022-challenges` both null) | **NO-GO** — all rights reserved.                                                                                                                           |

**⇒ All 40 Cybench sandbox images are NO-GO to redistribute** absent per-competition
permission. Base images (python/alpine/debian/ubuntu/nginx/php/openjdk/rust — all
freely redistributable) are NOT the blocker; the **challenge content license is**.

---

## Layer 2 — CVE-Bench targets (the redistributable path): bundled software

Framework is Apache-2.0 (UIUC). Each target bundles a real vulnerable app under its
own license. Verified each app's license from its own repo (not from memory).

| CVE             | Bundled app (version)                                                                             | App license                                                  | Base image                 | Verdict              | Obligation                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CVE-2024-34359  | llama-cpp-python 0.2.70                                                                           | **MIT**                                                      | python-alpine              | **GO**               | LICENSE + copyright notice                                                                                                                                                                                                                                     |
| CVE-2024-32964  | LobeChat **v0.150.5** (source zip) + npm tree                                                     | **MIT** _at that tag_                                        | python-alpine              | **GO**               | LICENSE + notice. ⚠ current LobeChat is NOASSERTION/custom — pin the version; npm dep tree not individually audited (predominantly permissive)                                                                                                                 |
| CVE-2024-32980  | Fermyon Spin 2.4.0 + demo app                                                                     | **Apache-2.0**                                               | rust-slim                  | **GO**               | LICENSE + NOTICE + change notices                                                                                                                                                                                                                              |
| CVE-2024-32986  | PWAsForFirefox 2.10.0 (`.deb`)                                                                    | **MPL-2.0**                                                  | ubuntu:20.04               | **GO**               | MPL file-level source availability. Confirmed: Firefox is fetched at container start (`do_site_install.sh` → `firefoxpwa site install`), NOT at build — a `docker save` of the built image contains only `firefoxpwa` + Ubuntu base, no branded Firefox binary |
| CVE-2024-4323   | Fluent Bit 2.0.9 (official image)                                                                 | **Apache-2.0**                                               | fluent/fluent-bit:2.0.9    | **GO / CONDITIONAL** | Re-hosts CNCF official image; Apache attribution + NOTICE; "Fluent Bit" trademark — don't imply endorsement                                                                                                                                                    |
| CVE-2024-4701   | Netflix Genie 4.3.0 **+ pulls** trinodb/trino:374, harisekhon/hadoop:2.7, netflixoss/genie-demo-* | all **Apache-2.0** software (harisekhon recipes MIT)         | netflixoss/genie-app:4.3.0 | **CONDITIONAL**      | Multiple third-party images + heavy attribution. **Recommend pulling these from their existing Docker Hub homes** rather than re-hosting                                                                                                                       |
| CVE-2024-5084   | WordPress 6.6.1 + Hash Form plugin 1.1.0 **+ pulls** mysql:8.0                                    | **GPLv2+** (WP + plugin) / **GPLv2** (MySQL)                 | wordpress:6.6.1            | **CONDITIONAL**      | Copyleft: must accompany with corresponding source or a written offer. "WordPress"/Oracle "MySQL" trademarks — rename, add disclaimer                                                                                                                          |
| CVE-synthetic-0 | CAISI-authored synthetic app + pip deps                                                           | **CAISI-authored, no explicit grant** (NOT in upstream UIUC) | python-slim/alpine         | **CONDITIONAL**      | Subtree's UIUC Apache LICENSE arguably covers it but copyright says UIUC; confirm CAISI intends Apache-2.0 (or treat as NIST public-domain). Low risk, not clean                                                                                               |

---

## Other artifacts

| Artifact                                                                 | License situation                                                                                               | Verdict         | Note                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAISI **agent image**                                                    | Kali base (`kalilinux/kali-last-release`) + pentest tools (mostly GPL) + i386 libs + Playwright + `axios` (MIT) | **CONDITIONAL** | Kali software is redistributable, but **"Kali Linux" is OffSec's trademark**. Prefer: pull the Kali base from Docker Hub (already public) + keep the thin tool layer as a fast build; or re-host under a non-Kali name with a trademark disclaimer |
| promptfoo-authored tasks (F2 "Hybrid AD → Cloud Takeover", defense twin) | promptfoo's own code on `python:3.12-alpine`; no third-party challenge content                                  | **GO**          | promptfoo's own IP; base image freely redistributable. Fully redistributable                                                                                                                                                                       |
| CAISI harness **code / build contexts**                                  | unlicensed (see Layer 1)                                                                                        | avoid           | Don't redistribute CAISI's unlicensed source/Dockerfile edits. Redistribute **built images** only; for CVE-Bench base redistribution on UIUC's Apache-2.0 upstream + attribution                                                                   |

---

## Cross-cutting obligations (for every GO / CONDITIONAL)

- **Apache-2.0:** include the LICENSE, retain copyright/attribution notices, and state
  files changed (§4). Neither cve-bench nor fluent-bit ships a NOTICE file → none to
  reproduce, but re-attach per-source copyright.
- **MIT:** include the license text + copyright line.
- **MPL-2.0:** make source of modified MPL files available.
- **GPLv2 (CVE-2024-5084):** accompany the image with corresponding source or a written
  offer valid 3 years.
- **GPL packages inherited from base images** (present in nearly every image): source-
  offer obligation is satisfied by referencing the upstream distro's published sources
  (Debian/Ubuntu/Alpine). State once, globally — not per image.
- **Trademarks:** Kali (OffSec), WordPress (Automattic), MySQL (Oracle), Fluent Bit
  (LF/CNCF) — names/logos are not licensed by the software license. Rename artifacts,
  don't imply endorsement, add a disclaimer.
- **CAISI stripped per-competition notices** when vendoring. Any redistributed item
  needs the ORIGINAL upstream notices re-attached.

---

## Recommendation summary

**Redistributable now (GO):**

- promptfoo's own authored tasks (F2, defense twin).
- CVE-Bench permissive targets: CVE-2024-34359 (MIT), -32964 (MIT@tag), -32980 (Apache),
  -32986 (MPL), -4323 (Apache) — with per-source attribution/NOTICE.

> **The CVE-Bench GO path is gated by the agent image.** Every CVE-Bench `compose.yml`
> references `agent-environment:1.1.1`, so a working pull-not-build CVE flow still needs
> the Kali-based agent image resolved (base-pull + thin build, or rename + disclaimer).
> The agent-image decision is a gate on the whole positive path, not a side item.

**Redistributable with conditions (CONDITIONAL):**

- CVE-2024-5084 (GPL source-offer + WordPress/MySQL trademarks).
- CVE-2024-4701 (many Apache images — prefer pulling from vendor Docker Hub).
- CVE-synthetic-0 (confirm CAISI intends Apache-2.0 / NIST public domain).
- Agent image (Kali trademark — prefer base-pull + thin build, or rename + disclaimer).

**NOT redistributable (NO-GO):**

- **All 40 Cybench challenge images** — SekaiCTF (NonCommercial + AGPL), HackTheBox,
  Glacier, HKCERT (no license). Remedy: request per-competition permission, or keep
  building these locally.

**Strategic bad news to surface:** the Cybench set is the _bulk_ of the ~40 build
targets and the likeliest apt-rot offenders (EOL buster/bullseye bases). That is
exactly the part we cannot redistribute. "Pull-not-build" as a blanket fix is blocked
by licensing for the majority; the clean win is promptfoo's own tasks + the Apache/MIT
CVE-Bench targets. Note also that several CVE targets already **pull public vendor
images** (wordpress, mysql, fluent-bit, trino, hadoop, genie) — for those, the win is
mostly "pull vendor base (already hosted) + fast thin wrapper build", which sidesteps
most re-hosting/redistribution exposure entirely.

## Open items to confirm before any Step 2 upload

1. **One confirmation from CAISI** (a LICENSE in `usnistgov/caisi-cyber-evals`, or an
   issue reply) that its modifications/additions are Apache-2.0. This single action
   removes the ambiguity for **all 8 CVE-Bench targets, CVE-synthetic-0, and the agent
   build recipe** — the cheapest de-risk available.
2. navnn confirms public availability is intended, the **exact HF repo/namespace**, and
   gives an explicit go.
3. Decide agent-image handling (base-pull + thin build vs. rename + disclaimer) — gates
   the whole CVE-Bench GO path.
4. If pursuing Cybench at all: obtain written permission from HTB / Glacier / HKCERT,
   and honor SekaiCTF's NonCommercial terms (i.e., do not redistribute for commercial
   use).

## Adjacent risk (out of this audit's scope, flagged for awareness)

The SekaiCTF NonCommercial (CC BY-NC-SA 4.0) finding also touches **current** practice:
users who build the 12 SekaiCTF images locally and run them through promptfoo — a
commercial product — are already using NonCommercial-licensed content. This is not
about redistribution and is not a Step-1 blocker, but navnn should be aware it exists.

**No images or assets have been uploaded anywhere. This document is the Step-1
deliverable for navnn's review.**

---

## Phase 2b — fetch-at-build model + per-app rulings (2026-09-10)

CVE-Bench is porting toward ~40 CVEs under the **fetch-at-build** model: each task's
Dockerfile FETCHES the vulnerable app from its OFFICIAL source at build time; nothing is
bundled; the user builds locally. **Key consequence:** promptfoo does not _redistribute_
the third-party app — it ships only its own harness glue + a fetch recipe. So a **clear
copyleft** license's distribution obligations do not attach to promptfoo. This does **not**
rescue unclear licenses or unpinnable sources.

**Clear copyleft (GPL/AGPL) → GO** under fetch-at-build, provided: (1) fetch from the
OFFICIAL source PINNED to a version/tag (not a mutable master); (2) no modification, no
bundling of the app's source; (3) the user runs it locally for eval (not promptfoo hosting
it as a network service → AGPL §13's network clause is not triggered by shipping the
recipe). Confirmed for Jan, SuiteCRM, Stalwart, Froxlor (A/GPL) and Dolibarr,
ChuanhuChatGPT, Cacti, Zabbix (GPLv2/3). Confirm the exact SPDX per pinned version (e.g.
Zabbix relicensed GPLv2→AGPL-3.0 at 7.0).

**Permissive (Apache/MIT/BSD, WordPress.org GPL plugins) → GO** under fetch-at-build.

**Unclear license OR unpinnable source → PARK / NO-GO** (conservative mandate; fetch-at-build
does NOT rescue these):

- CVE-2024-32167 (Online Medicine Ordering), CVE-2024-37831 (Payroll), CVE-2024-37849
  (Billing): **NO-GO** — no fetchable official archive, so including them forces BUNDLING an
  unclear-license zip = redistribution.
- CVE-2024-31611 SeaCMS: **PARK** — mutable master (no pinnable release) + nonstandard
  license. Un-park only with a versioned tag + a clear license.
- CVE-2024-36779 Stock Management: **PARK** — fetchable but unversioned (no pin →
  supply-chain/repro risk) + unclear license. Un-park only with a stable version + clear
  source terms.

**Rule going forward:** fetch-at-build clears CLEAR licenses (including copyleft); an
UNCLEAR license OR an unpinnable/mutable source parks the app until clarified. New Phase-2b
apps get triaged against this before CVE-Bench authors them.
