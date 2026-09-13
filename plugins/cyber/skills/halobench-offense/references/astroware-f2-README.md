# astroware/f2 — prebuilt F2 "Hybrid AD → Cloud Takeover" task images

> This is the **README to publish into the HuggingFace repo** (`huggingface.co/astroware`),
> not a promptfoo-repo doc. It documents what's stored and how to pull-and-run F2. Only
> promptfoo's **own authored** task images live here — **no third-party benchmark content**
> (Cybench / CVE-Bench are build-your-own; see the promptfoo cyber plugin).

## What this is

Prebuilt Docker images for **F2 "Hybrid AD → Cloud Takeover"** — promptfoo's own authored
offensive-eval task. The estate is a **pure-Python simulation** (9 small services on
`python:3.12-alpine`): identity/AD, portal, CI, cloud IAM, cloud app, directory,
deployment, monitoring, backup. There is **no real Windows/AD/Samba, no third-party or
branded software** baked in — every service is promptfoo's own `app.py` on the official
Python/Alpine base. Hosting these here just saves you the local build.

**These images contain no flag, oracle, or walkthrough.** The solution, generator, and
validator live outside every build context, and per-run flags are injected at runtime — a
pulled image cannot leak the answer.

## Licensing / attribution

- **Task code:** promptfoo's own IP.
- **Base image:** official [`python:3.12-alpine`](https://hub.docker.com/_/python) (PSF
  license for Python; MIT-style for Alpine/musl) — freely redistributable.
- Nothing else is bundled, so there is no third-party NOTICE to reproduce.

## What's stored

- Nine gzipped `docker save` tarballs, one per F2 service (see `manifest.json` for the
  exact image tag ↔ sha256 ↔ service mapping).
- `manifest.json` — verifiable image manifest.
- This README.

**Not stored here:** the shared agent (attacker toolkit) image. It is Kali-based, and
"Kali" is a trademark, so it is **not** re-hosted — you pull the official Kali base and
build a thin tool layer locally (below). Also not here: any Cybench/CVE-Bench image.

## Pull-and-run

Prereqs: Docker, the promptfoo cyber plugin checked out, and a model endpoint
(`CYBER_SUT_ENDPOINT` + `CYBER_MODEL` + one key).

```bash
# 1. Pull + load the 9 prebuilt F2 images (no estate build)
huggingface-cli download astroware/f2 --local-dir ./f2-images --repo-type model
for t in ./f2-images/*.tar.gz; do gunzip -c "$t" | docker load; done

# 2. The plugin's F2 pull-mode uses the loaded images (tag-matched to the compose
#    services) instead of rebuilding the estate. (See the plugin's F2 run path.)

# 3. The shared agent image is NOT hosted — build the thin tool layer on the official
#    Kali base once (fast; avoids re-hosting a "Kali"-named image):
#    (the plugin's setup builds agent-environment:1.1.1 from the Kali base)

# 4. Run the eval
promptfoo eval -c <plugin>/scripts/promptfooconfig.f2.yaml
```

**Honest note — not literally zero-build:** F2's own estate is pull-and-run (loaded, not
rebuilt), but the shared agent image is still a small local build on the Kali base. That
is by design (trademark), and it is far faster and more reliable than building the whole
estate from scratch.

## Safety framing

F2 is an **offensive-eval** sandbox (a simulated vulnerable estate). Run it isolated. Note
the plugin's tiers: the **default** tier gives container isolation but does **not**
network-contain the agent; the enforced network boundary is the opt-in **assurance** tier.
Pick the tier that matches the risk of the model you are testing.
