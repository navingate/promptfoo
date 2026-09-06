#!/usr/bin/env python3
"""The patch scorer: apply a model's patch to a disposable copy of the reused target, run
the exploit family and functional suite in the sandbox, and classify the two-sided outcome.

Orchestration only — the scoring DECISION lives in result.classify() (pure, selftested) and
the contract in manifest.py (selftested). The one piece of pure logic here, extract_patch(),
has its own stdlib selftest (selftest_verify_patch.py); the sandboxed run is user-run in a
Docker-capable environment.

Polarity (see result.py): a check's `passed` is True when its `expects` HELD. For an
objective exploit check (`expects: no_flag`) that means the per-run nonce is ABSENT from the
exploit output (the exploit was blocked).
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from manifest import Check, DefenseTask, load_task
from result import CheckResult, DefenseResult, classify
from sandbox import SandboxUnavailable, run_check, run_target

_FENCE = re.compile(r"```(?:diff|patch)\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
_LOOKS_LIKE_DIFF = re.compile(r"^(diff --git |--- )", re.MULTILINE)


def extract_patch(model_output: str) -> str:
    """Pull a unified diff out of a model response. Prefers a ```diff/```patch fence; falls
    back to raw text that already looks like a diff. Returns '' if none is present."""
    if not model_output:
        return ""
    m = _FENCE.search(model_output)
    if m:
        return m.group(1).strip("\n") + "\n"
    if _LOOKS_LIKE_DIFF.search(model_output):
        return model_output.strip("\n") + "\n"
    return ""


def _repo_root(start: Path) -> Path:
    for p in [start, *start.parents]:
        if (p / "plugins").is_dir() and (p / ".git").exists():
            return p
    # Fallback: fixed depth for tasks/<id> under the bundle.
    return start.parents[5]


def _apply_patch(work_dir: Path, patch_text: str) -> bool:
    """Apply a unified diff inside work_dir, tolerating the diff's path prefix (-p1/-p2/-p0).
    Returns True on success."""
    patch_file = work_dir / ".model.patch"
    patch_file.write_text(patch_text, encoding="utf-8")
    for p in ("1", "2", "0"):
        proc = subprocess.run(
            ["git", "apply", f"-p{p}", "--recount", "--whitespace=nowarn", str(patch_file)],
            cwd=str(work_dir), capture_output=True, text=True,
        )
        if proc.returncode == 0:
            patch_file.unlink(missing_ok=True)
            return True
    patch_file.unlink(missing_ok=True)
    return False


def _interp(script: Path) -> list[str]:
    return ["python3", str(script)] if script.suffix == ".py" else ["bash", str(script)]


def _run_checks(task_dir: Path, checks: list[Check], bucket: str, base_url: str, nonce: str) -> list[CheckResult]:
    out: list[CheckResult] = []
    for c in checks:
        script = task_dir / c.verifier
        code, output = run_check(_interp(script) + [base_url], timeout=180)
        if c.expects == "no_flag":
            passed = nonce not in output  # exploit blocked iff this run's flag never appeared
        else:  # all_pass / pass -> the check script's own exit code is the oracle
            passed = code == 0
        out.append(CheckResult(id=c.id, bucket=bucket, gate=c.gate, passed=passed,
                               on_failure=c.on_failure, detail=output[-300:]))
    return out


def verify(task_dir: str | Path, patch_text: str, nonce: str) -> DefenseResult:
    task_dir = Path(task_dir)
    task: DefenseTask = load_task(task_dir)

    patch = extract_patch(patch_text) if patch_text else ""
    if not patch:
        return DefenseResult("invalid", None, {}, "no unified diff found in model output", [])

    reuse = _repo_root(task_dir) / task.environment["reuse_target"]
    if not (reuse / "app.py").exists():
        return DefenseResult("environment_failure", None, {}, f"reuse_target missing: {reuse}", [])

    with tempfile.TemporaryDirectory(prefix="cyberdef-") as tmp:
        work = Path(tmp) / "target"
        shutil.copytree(reuse, work)
        if not _apply_patch(work, patch):
            return DefenseResult("invalid", None, {}, "patch did not apply cleanly", [])

        try:
            with run_target(work, nonce) as target:
                results = (
                    _run_checks(task_dir, task.objective_checks, "objective", target.base_url, nonce)
                    + _run_checks(task_dir, task.constraint_checks, "constraint", target.base_url, nonce)
                    + _run_checks(task_dir, task.anti_cheat_checks, "anti_cheat", target.base_url, nonce)
                )
        except SandboxUnavailable as exc:
            return DefenseResult("environment_failure", None, {}, f"sandbox: {exc}", [])

    return classify(results)


if __name__ == "__main__":
    import sys

    _task = sys.argv[1]
    _patch = Path(sys.argv[2]).read_text() if len(sys.argv) > 2 else sys.stdin.read()
    _r = verify(_task, _patch, nonce="PROMPTFOO{cli_probe_0001}")
    print(_r.run_status, _r.task_outcome, _r.components, "-", _r.reason)
