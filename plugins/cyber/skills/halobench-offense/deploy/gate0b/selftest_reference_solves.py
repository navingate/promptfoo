#!/usr/bin/env python3
"""Reference-solve CI guardrail — every runnable task must be SOLVABLE (the D3 lesson).

D3 scored 0/3 not because it was hard but because its target crashed on any exec output — an
unsolvable task masquerading as a hard one. This check runs each task's committed reference solve
against its target IN-PROCESS and asserts it recovers the (per-run injected) flag. A broken target
fails here instead of silently inflating "difficulty" in a model run.

Coverage is honest about the authoring sandbox's limits: it runs the single-service, stdlib,
constant/env-flag tasks (the atomic diagnostics + crypto + forensics — exactly the class D3 was in,
and the class NOT otherwise covered in CI). It SKIPS, with a reason, what needs a real host:
  - multi-service scenarios      -> segmented docker networks (host)
  - file-baked /flag tasks       -> flag written to an absolute path at container start (host docker)
  - compiled pwn/rev targets     -> need gcc + docker (host verify_pwn.sh)
  - framework tasks (pip deps)   -> host docker
  - S* enterprise chains         -> their intended path is a positive control in selftest_anti_cheat.py

Pure stdlib. Run:  python3 selftest_reference_solves.py [--verbose]
"""
from __future__ import annotations

import importlib.util
import os
import re
import secrets
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

TASKS = Path(__file__).resolve().parent.parent.parent / "tasks"
KEY_RE = re.compile(r"PFCYBER_NONCE_(\w+)")
VERBOSE = "--verbose" in sys.argv
FAILS, RAN, SKIPPED = [], [], []


def classify(task: Path):
    """Return ('run', service_dir) or ('skip', reason)."""
    if not (task / "solution" / "solve.sh").exists():
        return ("skip", "no reference solve")
    # NOTE: single-service enterprise scenarios (S4/S5/S7-S17) ARE run here — their reference
    # solves must recover a per-run nonce too. (They were previously skipped as "covered by
    # anti_cheat"; but anti_cheat's positive control uses an inlined calibrator, not the committed
    # solve.sh, so it missed 13 solves whose grep hardcoded the flag prefix and broke under nonces.)
    svcs = [d for d in sorted(task.iterdir()) if d.is_dir() and (d / "app.py").exists()]
    if len(svcs) == 0:
        return ("skip", "no in-process app (compiled/host target)")
    if len(svcs) > 1:
        return ("skip", "multi-service (host docker)")
    svc = svcs[0]
    if list(svc.glob("*.c")):
        return ("skip", "compiled binary (host verify_pwn.sh)")
    if (svc / "requirements.txt").exists():
        return ("skip", "framework deps (host docker)")
    df = svc / "Dockerfile"
    dtext = df.read_text(errors="ignore") if df.exists() else ""
    if "pip install" in dtext:
        return ("skip", "framework deps (host docker)")
    if re.search(r">\s*/flag", dtext):
        return ("skip", "file-baked /flag (host docker)")
    return ("run", svc)


def scan_keys(svc: Path) -> list[str]:
    keys: set[str] = set()
    for f in svc.rglob("*"):
        if f.is_file() and "__pycache__" not in f.parts:
            try:
                keys.update(KEY_RE.findall(f.read_text()))
            except (UnicodeDecodeError, OSError):
                pass
    return sorted(keys)


def run_one(task: Path, svc: Path) -> None:
    keys = scan_keys(svc)
    nonces = {k: f"PROMPTFOO{{{task.name}_{k}_{secrets.token_hex(8)}}}" for k in keys}
    env = {f"PFCYBER_NONCE_{k}": v for k, v in nonces.items()}
    term = env.get("PFCYBER_NONCE_TERMINAL")
    if not term:
        FAILS.append(f"{task.name}: target reads no PFCYBER_NONCE_TERMINAL (cannot verify)")
        return
    # fresh import with the injected nonce
    for k in list(os.environ):
        if k.startswith("PFCYBER_NONCE_"):
            del os.environ[k]
    os.environ.update(env)
    mod_name = f"refsolve_{task.name}_{secrets.token_hex(3)}"
    try:
        spec = importlib.util.spec_from_file_location(mod_name, svc / "app.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
    except Exception as e:  # noqa: BLE001
        FAILS.append(f"{task.name}: target failed to start in-process ({type(e).__name__}: {e})")
        return
    port = srv.server_address[1]
    threading.Thread(target=lambda: srv.serve_forever(poll_interval=0.02), daemon=True).start()
    try:
        out = subprocess.run(["bash", str(task / "solution" / "solve.sh"), f"http://127.0.0.1:{port}"],
                             capture_output=True, text=True, timeout=45)
        recovered = term in (out.stdout + out.stderr)
        if recovered:
            RAN.append(task.name)
            if VERBOSE:
                print(f"  PASS  {task.name}")
        else:
            FAILS.append(f"{task.name}: reference solve did NOT recover the flag "
                         f"(rc={out.returncode}) — target may be broken. stderr: {out.stderr.strip()[-160:]}")
    except subprocess.TimeoutExpired:
        FAILS.append(f"{task.name}: reference solve timed out (>45s)")
    finally:
        srv.shutdown()
        srv.server_close()


def main() -> int:
    for task in sorted(TASKS.glob("*")):
        if not task.is_dir() or task.name in ("_smoke", "__pycache__") or task.name.startswith("."):
            continue
        kind, info = classify(task)
        if kind == "skip":
            SKIPPED.append((task.name, info))
            if VERBOSE:
                print(f"  SKIP  {task.name}  ({info})")
        else:
            run_one(task, info)

    print()
    print(f"  reference solves run + PASSED : {len(RAN)}")
    print(f"  skipped (host-verified/covered): {len(SKIPPED)}")
    if not VERBOSE and SKIPPED:
        # group skip reasons
        from collections import Counter
        for reason, n in Counter(r for _, r in SKIPPED).most_common():
            print(f"      {n:2d}  {reason}")
    if FAILS:
        print(f"\n*** {len(FAILS)} FAILED (a broken/unsolvable target):")
        for f in FAILS:
            print(f"   - {f}")
        return 1
    print("\nALL RUNNABLE REFERENCE SOLVES RECOVER THE FLAG (no broken targets in the in-process set)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
