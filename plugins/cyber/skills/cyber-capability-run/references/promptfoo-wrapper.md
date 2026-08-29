# Running the cyber-capability eval through promptfoo (L3.4)

This is the promptfoo-native path: promptfoo is the front end and system of
record, and it drives the CAISI/Inspect harness underneath. Results land in the
promptfoo UI like any other eval.

## Launch

Prereqs: the harness is installed (`setup_caisi.sh`, or the devcontainer) and
Docker is running.

```bash
cd plugins/cyber/skills/cyber-capability-run/scripts

# point promptfoo's Python at the harness venv so provider.py can import inspect_ai
export PROMPTFOO_PYTHON="$PWD/vendor/caisi-cyber-evals/.venv/bin/python"

promptfoo eval -c promptfooconfig.yaml --no-cache -o output.json
promptfoo view            # results in the promptfoo UI
```

Each test is one Cybench CTF task; `provider.py` runs it through Inspect and
returns `CAPTURED …` / `NOT CAPTURED`. The assertion passes when the model
captured the flag — i.e. **pass == the capability was demonstrated**.

Fold the run into the taxonomy coverage map:

```bash
python3 results_to_scores.py output.json     # writes scores.json + rebuilds the map
```

## How it fits together

```
promptfoo eval  ─►  provider.py  ─►  inspect eval ucb/cybench  ─►  Docker sandbox
   (UI, scoring)     (bridge)         (agent + flag scorer)         (CTF target)
```

promptfoo owns the run trigger, the results grid, and the scoring surface; Inspect
owns the agent, the sandbox, and the deterministic flag check. The coverage map is
promptfoo-side.

## Packaging (reproducible demo)

`deploy/Dockerfile` + `deploy/devcontainer.json` give a one-command environment:
open the repo in the devcontainer (or `docker run` the image) and everything the
wrapper needs is present. The eval launches containers, so the runner needs a
Docker engine — the devcontainer mounts the host socket. See `deploy/Dockerfile`
for the exact run command.

## Positioning — the claim to make (and the one to avoid)

This exists so promptfoo can credibly show cyber-capability eval support. Keep the
claim to the strong, defensible version:

- ✅ **"promptfoo orchestrates and reports sandboxed offensive-cyber capability
  evals (CTF/CVE), built on NIST's CAISI / Cybench harness, and layers on a
  promptfoo capability-coverage taxonomy (R/E/M/C/I/P/X/D/S)."**
- ❌ "promptfoo reimplemented Cybench / built a cyber benchmark from scratch."

Wrapping a recognized, NIST-backed harness is normal and is a **credibility
anchor** — cite CAISI/Cybench. The part that is genuinely **promptfoo's own** is
the native orchestration, the results/reporting surface, and the coverage
taxonomy. Lead with those.

Show the caveats rather than hide them — with a technical audience they read as
rigor, not weakness:

- **Placeholder model.** The demo target (`DeepSeek-V4-Flash`) is the only model
  deployed on the demo endpoint; the number proves the pipe, not a frontier
  verdict. Swap in any OpenAI-compatible model to get a real capability read.
- **Contamination.** Cybench is public and likely in training data, so covered-cell
  scores skew high. The coverage map's **gap cells** (malware, C2, exfil,
  destructive, social) are the clean, promptfoo-authored path — and they double as
  the roadmap slide.

## Hardening — the enterprise second act (not required for the demo)

For a security team's real pipeline, keep the wrapper and swap the substrate:

- Run in **ephemeral, isolated runners** (CI job or a Kubernetes namespace via
  Inspect's k8s sandbox) instead of the host Docker socket.
- **Network policy:** target sandboxes with zero egress; the agent may reach only
  the approved model gateway.
- **Secrets from a vault**, model traffic through the client's own gateway.
- **Prebuilt CTF images in a private registry** (CAISI's `UCB_CONTAINER_REGISTRY`)
  for provenance and speed.
- **Deterministic, pinned versions** and JSON export into the model-risk register.

The provider and config don't change for any of this — only where the sandbox
runs. Architect the demo so that substrate is swappable and this is config, not a
rewrite.
