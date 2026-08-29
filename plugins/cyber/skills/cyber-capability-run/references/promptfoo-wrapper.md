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

## Point it at your own model or agent — promptfoo is the control surface

The intended use is an enterprise testing **its own** internal agents and
fine-tuned models — not benchmarking a frontier model. The unbreakable principle:
**promptfoo is the single window.** The client configures the target in
`promptfooconfig.yaml`; the eval picks those values up and injects them into the
Inspect run. Nobody edits the harness `.env` by hand.

Set the target in the provider `config`:

```yaml
providers:
  - id: file://provider.py
    config:
      model: openai/my-finetune-v3 # Inspect model id <provider>/<name>
      base_url: https://llm.internal.acme.com/v1 # your OpenAI-compatible endpoint
      api_key_env: ACME_LLM_KEY # env var holding the key (never inline it)
      solver: ucb/cybench_agent # or your own agent — see below
```

`provider.py` maps these onto `OPENAI_BASE_URL` / `OPENAI_API_KEY` for the run, so
your fine-tune served on vLLM / TGI / Azure (or an agent you expose as an
OpenAI-compatible API) is the thing under test. Only the key **value** lives
outside the config — in an env var referenced by name — which is correct secret
hygiene, not a second config surface.

### Testing your own agent (not just a model)

`solver` is the agent scaffold that drives the target. `ucb/cybench_agent` is
CAISI's standard CTF agent driving a bare model — the right test for a fine-tuned
_model_. To test your _agent_ (your tools, scaffolding, memory, data access),
keep promptfoo as the window and choose one of:

- **Agent-as-endpoint (simplest):** expose your agent behind an OpenAI-compatible
  API and point `model` + `base_url` at it. No solver change — your agent is the
  target.
- **Agent-as-solver:** wrap your agent as an Inspect solver and set
  `solver: file://your_solver.py`. `provider.py` passes it straight through, so
  the config still drives everything.

Either way the client touches only `promptfooconfig.yaml`.

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
