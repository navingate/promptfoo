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

from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.scorer import includes
from inspect_cyber.dataset import create_agentic_eval_dataset

TASKS_DIR = Path(__file__).resolve().parent


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
        dataset=dataset,
        scorer=includes(),
    )
