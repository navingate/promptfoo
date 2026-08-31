#!/usr/bin/env python3
"""Promptfoo provider: run ONE Cybench task through the CAISI/Inspect harness and
report whether the target model captured the flag.

This is the promptfoo -> Inspect bridge. It lets `promptfoo eval` drive a
sandboxed offensive-cyber capability eval and surface the result in the promptfoo
UI. The heavy lifting — the agent, the Docker sandbox, and the deterministic flag
scorer — is CAISI/Inspect; this file only orchestrates one task and translates the
outcome back into promptfoo's provider contract.

Promptfoo calls `call_api(prompt, options, context)` per test case. It runs the
harness via the harness venv's own `inspect` binary, and parses the result with
inspect_ai — importing it directly when promptfoo already runs under the harness
Python, otherwise re-invoking the harness venv to parse. So it works whether or
not PROMPTFOO_PYTHON points at the CAISI env (pointing it there is still cleanest).

Prereq: the harness is installed (run setup_caisi.sh, or use the cyber
devcontainer/image) and Docker is running.

Config `benchmark` selects the task suite: "cybench" (default) runs CAISI's
public Cybench tasks (the pipe-proof / contaminated demo); "authored" runs
promptfoo's own enterprise task suite from ../tasks/loader.py.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _cfg(options, key, default=None):
    """Resolve a setting from the provider config, then env (CYBER_<KEY>), then default."""
    cfg = (options or {}).get("config", {}) or {}
    if key in cfg and cfg[key] is not None:
        return cfg[key]
    return os.environ.get(f"CYBER_{key.upper()}", default)


def _resolve_caisi_dir(raw):
    """Accept an absolute path, or one relative to this provider file."""
    if not raw:
        raw = "vendor/caisi-cyber-evals"
    p = Path(raw)
    if not p.is_absolute():
        p = (HERE / p).resolve()
    return p


def _venv_bin(caisi_dir, name):
    """Path to a binary in the harness venv, or the bare name if the venv is absent."""
    candidate = caisi_dir / ".venv" / "bin" / name
    return str(candidate) if candidate.exists() else name


# Authored tasks live in OUR bundle (never the gitignored CAISI clone) and load
# through tasks/loader.py's `pfcyber` task. See ../tasks/loader.py and
# ../references/build-plan.md.
AUTHORED_LOADER = HERE.parent / "tasks" / "loader.py"


def call_api(prompt, options=None, context=None):
    options = options or {}
    ctx_vars = (context or {}).get("vars", {}) or {}
    task = (ctx_vars.get("task") or (prompt or "")).strip()
    if not task:
        return {"error": "no task specified — set vars.task (e.g. flag_command)"}

    model = _cfg(options, "model", "openai/DeepSeek-V4-Flash")
    solver = _cfg(options, "solver", "ucb/cybench_agent")
    # The ucb agents build a Ghidra decompile tool whose constructor pings GaaS
    # (Ghidra-as-a-Service) at localhost:5000 and HARD-ERRORS when it's offline. We
    # don't run GaaS for the authored/smoke path (heavy; no reverse-engineering), so
    # disable that tool by default. Override with use_ghidra_tool: true AND run GaaS.
    use_ghidra = str(_cfg(options, "use_ghidra_tool", "false")).lower()
    token_limit = str(_cfg(options, "token_limit", "200000"))
    # Read 'inspect_timeout' (SECONDS), NOT 'timeout'. `timeout` is a RESERVED
    # promptfoo Python-provider key: promptfoo consumes it as the worker CALL
    # timeout in MILLISECONDS and kills the worker at that bound before we ever
    # run. Set promptfoo's `timeout` (ms) larger than inspect_timeout*1000 in the
    # config so THIS inner subprocess guard fires first with a clean error dict.
    timeout = int(_cfg(options, "inspect_timeout", "1800"))
    caisi_dir = _resolve_caisi_dir(_cfg(options, "caisi_dir"))

    # "cybench" (default) runs CAISI's public Cybench suite (ucb/cybench, the
    # pipe-proof / contaminated demo tasks). "authored" runs promptfoo's own
    # enterprise task suite from tasks/loader.py — same harness, our content.
    benchmark = _cfg(options, "benchmark", "cybench")
    if benchmark == "authored":
        if not AUTHORED_LOADER.exists():
            return {"error": f"authored task loader not found: {AUTHORED_LOADER}"}
        # Use the file@task form, NOT a bare path. Inspect resolves a bare path via
        # root_dir.glob(target); an ABSOLUTE glob raises "Non-relative patterns are
        # unsupported" on Python 3.12. The `@pfcyber` form routes through inspect's
        # direct-file branch (task_path.absolute()), skipping the glob entirely.
        # `-T samples=` still selects the sample inside the pfcyber task.
        eval_target = f"{AUTHORED_LOADER}@pfcyber"
    elif benchmark == "cybench":
        eval_target = "ucb/cybench"
    else:
        return {
            "error": f"unknown benchmark '{benchmark}' — use 'cybench' or 'authored'"
        }

    if not caisi_dir.is_dir():
        return {"error": f"caisi_dir not found: {caisi_dir} — run setup_caisi.sh first"}

    # promptfoo is the single control surface: the target (the client's own model
    # or agent endpoint + key) is defined in the promptfoo provider config, and we
    # inject it into the Inspect subprocess env here. The client never edits the
    # harness .env — these values win.
    run_env = os.environ.copy()
    base_url = _cfg(options, "base_url")
    if base_url:
        run_env["OPENAI_BASE_URL"] = str(base_url)
    api_key = _cfg(options, "api_key")
    api_key_env = _cfg(options, "api_key_env")
    if api_key:
        run_env["OPENAI_API_KEY"] = str(api_key)
    elif api_key_env and os.environ.get(str(api_key_env)):
        run_env["OPENAI_API_KEY"] = os.environ[str(api_key_env)]

    log_dir = tempfile.mkdtemp(prefix=f"cyber_{task}_")
    cmd = [
        _venv_bin(caisi_dir, "inspect"),
        "eval",
        eval_target,
        "-T",
        f"samples={task}",
        "--solver",
        solver,
        # disable the GaaS-dependent Ghidra tool on ucb/* agents (see above)
        *(["-S", f"use_ghidra_tool={use_ghidra}"] if str(solver).startswith("ucb/") else []),
        "--model",
        model,
        "--token-limit",
        token_limit,
        "--log-dir",
        log_dir,
        "--no-fail-on-error",
    ]

    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(caisi_dir),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=run_env,
        )
    except FileNotFoundError:
        return {
            "error": "`inspect` not found — run setup_caisi.sh or use the cyber devcontainer"
        }
    except subprocess.TimeoutExpired:
        return {"error": f"inspect eval timed out after {timeout}s for task '{task}'"}
    elapsed = round(time.time() - started, 1)

    captured, score, answer, detail = _parse_log(log_dir, caisi_dir)
    # Outcome taxonomy (per the security review: an error/refusal is NEVER a
    # "non-solve"). captured is None for anything that is not a clean scored
    # result — a sample-level harness error, or an unreadable log. Those return a
    # promptfoo ERROR, distinct from a genuine non-solve.
    if captured is None:
        tail = (proc.stderr or "")[-2000:]
        return {
            "error": f"harness_error for '{task}' (rc={proc.returncode}); "
            f"detail={detail}; stderr tail: {tail}"
        }

    outcome = "demonstrated" if captured else "non_solve"
    output = f"CAPTURED — flag: {answer}" if captured else "NOT CAPTURED"
    return {
        "output": output,
        "metadata": {
            "captured": bool(captured),
            "outcome": outcome,
            "score": score,
            "task": task,
            "benchmark": benchmark,
            "model": model,
            "elapsed_s": elapsed,
            "log_dir": log_dir,
            "scorer_detail": detail,
        },
    }


def _parse_with_inspect(log_dir):
    """Return (captured, score, answer, detail) using inspect_ai, or None if unimportable."""
    try:
        from inspect_ai.log import list_eval_logs, read_eval_log
    except Exception:
        return None
    logs = list_eval_logs(log_dir)
    if not logs:
        return (None, None, None, "no eval logs written")
    log = read_eval_log(logs[-1])
    samples = getattr(log, "samples", None) or []
    for s in samples:
        # A sample-level error (model/provider failure, sandbox crash) must NOT be
        # read as a non-solve — surface it as a harness error (captured None).
        sample_err = getattr(s, "error", None)
        if sample_err:
            return (None, "ERROR", None, f"sample error: {str(sample_err)[:1200]}")
        scores = getattr(s, "scores", None) or {}
        for name, sc in scores.items():
            val = getattr(sc, "value", sc)
            captured = str(val).strip().upper() in ("C", "CORRECT", "1", "TRUE")
            answer = None
            out = getattr(s, "output", None)
            if out is not None:
                completion = getattr(out, "completion", None)
                answer = str(completion if completion is not None else out)[:200]
            return (captured, str(val), answer, f"scorer={name}")
    return (None, None, None, "no scores found in samples")


def _parse_log(log_dir, caisi_dir):
    """Parse the Inspect result: import inspect_ai directly, else via the harness venv."""
    direct = _parse_with_inspect(log_dir)
    if direct is not None:
        return direct
    # Fallback: promptfoo is running under a Python without inspect_ai. Re-invoke
    # THIS file's --parse mode under the harness venv Python, which has it.
    venv_py = caisi_dir / ".venv" / "bin" / "python"
    if not venv_py.exists():
        return (None, None, None, "inspect_ai not importable and no harness venv found")
    try:
        r = subprocess.run(
            [str(venv_py), str(Path(__file__).resolve()), "--parse", log_dir],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return tuple(json.loads(r.stdout))
    except Exception as e:
        return (None, None, None, f"venv parse failed: {e}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--parse":
        # internal: parse a log dir and print the tuple as JSON (used by the fallback)
        print(
            json.dumps(
                list(_parse_with_inspect(sys.argv[2]) or (None, None, None, "n/a"))
            )
        )
    else:
        # Manual smoke test: python provider.py <task> [benchmark]
        # e.g. python provider.py pfcyber-smoke authored
        t = sys.argv[1] if len(sys.argv) > 1 else "dynastic"
        bench = sys.argv[2] if len(sys.argv) > 2 else "cybench"
        print(
            json.dumps(
                call_api(t, {"config": {"benchmark": bench}}, {"vars": {"task": t}}),
                indent=2,
            )
        )
