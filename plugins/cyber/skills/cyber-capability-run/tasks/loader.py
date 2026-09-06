"""Inspect task loader for promptfoo's own authored enterprise cyber tasks.

Discovers every `eval.yml`/`eval.yaml` under this directory (each authored task
gets its own subfolder — see `../references/build-plan.md` for the authoring
recipe) via inspect_cyber's dataset loader, the same mechanism CAISI's own
`ucb/cybench` uses. This lets us add tasks without ever touching the gitignored
CAISI clone: this file lives in OUR bundle, not vendor/.

Run directly with Inspect (a real agent solver is required — bare `generate()` has
no tools and cannot fetch anything from the sandbox):

    cd plugins/cyber/skills/cyber-capability-run
    ../scripts/vendor/caisi-cyber-evals/.venv/bin/inspect eval tasks/loader.py \
        --solver ucb/cybench_agent \
        --model openai/DeepSeek-V4-Flash \
        --token-limit 20000

Or via the promptfoo provider by setting `benchmark: authored` in
`scripts/promptfooconfig.yaml` (see provider.py).
"""

import os
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.scorer import includes
from inspect_cyber.dataset import create_agentic_eval_dataset

TASKS_DIR = Path(__file__).resolve().parent


def _apply_gate0b_target(dataset):
    """Align the `includes()` scorer target with the PER-RUN terminal nonce Gate-0B serves.

    Under Gate-0B the target container serves a fresh per-run flag (PFCYBER_NONCE_TERMINAL),
    NOT eval.yml's static `flag`. The `includes()` scorer also drives the agent-facing
    `submit()` feedback DURING the run, so if its target stayed the static flag the agent
    would submit the (correct) per-run flag, be told "incorrect", derail, and leave an empty
    final submission — which Gate-0B then reads as `empty_submission`. So when this run
    injected a terminal nonce, use it as the target for the matching task's sample (the nonce
    embeds the task id, so it only rewrites its own sample). No nonce in env (non-Gate-0B run)
    -> targets are left as the static flag, unchanged. Defensive: never fail the load.
    """
    term = os.environ.get("PFCYBER_NONCE_TERMINAL")
    if not term:
        return dataset
    try:
        for sample in dataset:
            name = (getattr(sample, "metadata", None) or {}).get("eval_name", "")
            if name and name in term:
                sample.target = term
    except Exception:  # noqa: BLE001 — scorer target is best-effort; never break the eval load
        pass
    return dataset


@task
def pfcyber(samples: str | list[str] | None = None) -> Task:
    """Promptfoo-authored enterprise cyber-capability tasks.

    Args:
        samples: eval name(s) to include (matches each task dir's eval.yml
            `name:`), e.g. "pfcyber-smoke". None loads every authored task.
    """
    dataset = create_agentic_eval_dataset(
        TASKS_DIR, "pfcyber"
    ).filter_by_metadata_field("eval_name", samples)
    return Task(
        dataset=_apply_gate0b_target(dataset),
        scorer=includes(),
    )
