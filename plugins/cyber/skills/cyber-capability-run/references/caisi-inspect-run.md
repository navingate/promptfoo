# CAISI / Inspect run reference (L3 slice)

Verified against the `usnistgov/caisi-cyber-evals` source and README on
2026-08-28. Where a fact came from reading the vendored source (not just the
spec), it is marked **[verified in source]**.

## What CAISI is

`usnistgov/caisi-cyber-evals` packages three CTF/CVE benchmarks on top of the
[Inspect](https://inspect.aisi.org.uk/) eval framework:

- **Cybench** — 40 CTF tasks across six domains: crypto, web, reverse
  engineering, forensics, pwn, misc.
- **CVE-Bench** — 7 CVE reproduction tasks + a dev set.
- **pwn.college** — 615 tasks.

It registers an Inspect extension named `ucb` (see `pyproject.toml`
`[project.entry-points.inspect_ai] ucb = "ucb._registry"`), which exposes the
tasks `ucb/cybench`, `ucb/cvebench`, `ucb/ctf_archive` and the agents below.

## Corrections to the handoff spec (found by reading the source)

The spec gave an approximate command. Two details differ from the source:

1. **Sample parameter is `samples`, not `tasks`.** [verified in source:
   `src/ucb/tasks/task.py` `def cybench(samples: str | list[str] | None = ...)`]
   Use `-T samples=flag_command,dynastic,unbreakable`. The README example is
   `-T samples=avatar,delulu`.
2. **The cybench solver is `ucb/cybench_agent`** (the registry exports `agent`,
   `cybench_agent`, `cvebench_agent`). [verified in source:
   `src/ucb/_registry.py`, `src/ucb/agents/agents.py`]. The README also mentions
   `ucb/ctf_agent` / `ucb/ctf_solver` as aliases; `ucb/cybench_agent` is the
   safe, explicitly-registered choice. You MUST pass a `--solver`.

## Task selection (why these three)

One web, one crypto, one misc — all Ghidra-free, so the heavy GaaS (Ghidra)
service is never needed:

| Task           | Domain | Container shape                           |
| -------------- | ------ | ----------------------------------------- |
| `flag_command` | web    | agent + one small `flag-command` target   |
| `dynastic`     | crypto | agent + **alpine stub target** (no build) |
| `unbreakable`  | misc   | agent + one small `unbreakable` target    |

[verified in source: each task's `eval.yml` `category:` field and `compose.yml`;
`dynastic` includes `containers/blank_target.yml` whose target is
`alpine:latest`.]

### Sample-name caveat

`inspect_cyber` filters by an `eval_name` metadata field. For `dynastic` and
`unbreakable` the directory name equals the `eval.yml` `name`. For
`flag_command` the `eval.yml` name is `flag-command` (hyphen). If a run reports
"0 samples matched," resolve the exact tokens with:

```bash
bash scripts/list_samples.sh
```

and set `SAMPLES` in `scripts/config.env` accordingly.

## Minimal, timeboxed setup (what `setup_caisi.sh` does)

The upstream `ucb build` builds **all ~47 challenge images** and the core Ghidra
image — a rabbit hole. Instead we build only what the three tasks need:

```bash
# from the harness dir
uv venv && uv sync            # installs ucb + inspect_ai + inspect_cyber
ucb env-init                  # template .env (we then overwrite it, below)
# build ONLY the core agent image (not the Ghidra core image):
docker build -t agent-environment:1.1.1 \
  -f src/ucb/containers/agent/Dockerfile src/ucb/containers/agent
# build ONLY the target images that need one (dynastic uses the alpine stub):
for t in flag_command unbreakable; do
  cf=src/ucb/benchmarks/cybench/$t/compose.yml
  sed 's/ #context:/ context:/; s/ #build:/ build:/' "$cf" > "$cf.tmp"
  (cd "src/ucb/benchmarks/cybench/$t" && UCB_CONTAINER_REGISTRY= \
     docker compose -f compose.yml.tmp build target)
  rm -f "$cf.tmp"
done
```

We do **not** run `ucb gaas` — no reverse-engineering task is selected.

## Pointing Inspect at the Azure OpenAI-compatible endpoint

Inspect drives the target with `--model <provider>/<name>`. For an Azure
OpenAI-compatible endpoint, use Inspect's **openai** provider with a custom base
URL. The openai provider reads the standard OpenAI SDK env vars, so:

```bash
# in the harness .env (setup_caisi.sh writes these from AZURE_AI_* creds):
OPENAI_BASE_URL=<AZURE_AI_BASE_URL>
OPENAI_API_KEY=<AZURE_AI_API_KEY>
```

and run with `--model openai/DeepSeek-V4-Flash`.

> **Verify before relying on it.** `OPENAI_BASE_URL` is the standard OpenAI-SDK
> override that Inspect's openai provider inherits, but confirm against Inspect's
> live provider docs for your Inspect version — some Azure deployments need an
> `api-version` query param or the dedicated `azureai` provider instead. If the
> model returns auth/deployment errors, that is an endpoint-wiring issue, not a
> harness bug.

## Running

```bash
uv run inspect eval ucb/cybench \
  -T samples=flag_command,dynastic,unbreakable \
  --solver ucb/cybench_agent \
  --model openai/DeepSeek-V4-Flash \
  --token-limit 200000 \
  --no-fail-on-error
```

`run_cybench.sh` wraps this with a wall-clock timeout. Scoring is deterministic:
CAISI uses Inspect's `includes()` scorer [verified in source: `task.py`
`scorer=includes()`], i.e. the flag string must appear in the agent's final
submission. Read results with `uv run inspect view`.

## Interpreting the result (record these every time)

- **Placeholder model** — `DeepSeek-V4-Flash` is the only model deployed on the
  endpoint; the number proves the harness, not a frontier verdict.
- **Contamination** — Cybench is public and likely in training data; scores skew
  high. Freshly-authored tasks are the clean path.
- **A zero is a valid pipe-proof** — 0/3 captured still demonstrates the L3 pipe
  end-to-end. Do not grind for a non-zero.
- **Isolation** — offensive agent runs happen in the sandbox and can trip
  provider safeguards mid-run; a refusal-driven low score is a real result.

## Known issues

- **`AttributeError: 'OpenAIAPI' object has no attribute 'is_gpt_5'`** (confirmed
  2026-08-29). CAISI `main` calls `model.api.is_gpt_5()` in
  `src/ucb/agents/utils.py:_is_reasoning_model`, but the inspect_ai it locks to
  (0.3.103) only has `is_gpt` — so every cybench run crashes at agent init. This
  is an upstream CAISI defect (its code is ahead of its own pinned dependency),
  not the promptfoo wrapper. `setup_caisi.sh` applies a behavior-preserving shim
  (`getattr(model.api, "is_gpt_5", lambda: False)()`) after `uv sync`. If you set
  the harness up by hand, apply the same guard, or upgrade inspect_ai to a version
  that has `is_gpt_5` (watch for drift against `inspect-cyber==0.1.0`). The shim
  fixes this one blocker; report any further version-drift errors from a real run.
