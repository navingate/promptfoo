#!/usr/bin/env python3
"""Disposable target sandbox for the defense scorer.

A v0.1 patch task only needs the *target* service running with a per-run nonce, reachable
by our trusted check scripts. The reused offense targets are self-contained stdlib images
(see A3's target/Dockerfile: python:3.12-alpine, one file, EXPOSE 8080, reads the flag from
PFCYBER_NONCE_TERMINAL). So we build the (patched) target dir and `docker run` it directly,
publishing 8080 to 127.0.0.1 — no dependence on the offense inspect/compose machinery.

Isolation model: the UNTRUSTED artifact (the model's patched app.py) runs only inside the
container; our exploit/functional scripts run on the host and only speak HTTP to it, never
executing model code. This is the Gate-0A-grade baseline; the stronger Colima-VM +
egress-lockdown used by the offense suite is the Gate-0B hardening (follow-up), not needed
to prove the Slice-1 lifecycle.

Requires Docker. If Docker is unavailable, run_target raises SandboxUnavailable, which the
scorer maps to run_status="environment_failure" (excluded from model scoring).
"""

from __future__ import annotations

import contextlib
import json
import subprocess
import time
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path


class SandboxUnavailable(RuntimeError):
    """Docker is not usable, or the target failed to build/boot — a harness fault."""


@dataclass
class Target:
    base_url: str
    container: str


def _run(cmd: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def docker_available() -> bool:
    try:
        return _run(["docker", "info"], timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _wait_healthy(base_url: str, attempts: int = 40, delay: float = 0.5) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(base_url + "/healthz", timeout=3) as resp:
                if resp.status == 200 and json.loads(resp.read()).get("status") == "ok":
                    return True
        except Exception:
            time.sleep(delay)
    return False


@contextlib.contextmanager
def run_target(target_dir: str | Path, nonce: str):
    """Build and run `target_dir` (a dir with a Dockerfile), yielding a live Target.

    The container serves the per-run `nonce` as its flag and is force-removed on exit.
    """
    if not docker_available():
        raise SandboxUnavailable("docker is not available")

    target_dir = Path(target_dir)
    tag = f"cyberdef-target:{uuid.uuid4().hex[:12]}"
    name = f"cyberdef-{uuid.uuid4().hex[:12]}"

    build = _run(["docker", "build", "-q", "-t", tag, str(target_dir)], timeout=600)
    if build.returncode != 0:
        raise SandboxUnavailable(f"target build failed: {build.stderr.strip()[:500]}")

    run = _run(
        [
            "docker", "run", "-d", "--rm", "--name", name,
            "-e", f"PFCYBER_NONCE_TERMINAL={nonce}",
            "-p", "127.0.0.1:0:8080",
            tag,
        ],
        timeout=60,
    )
    if run.returncode != 0:
        _run(["docker", "rmi", "-f", tag], timeout=60)
        raise SandboxUnavailable(f"target run failed: {run.stderr.strip()[:500]}")

    try:
        port_line = _run(["docker", "port", name, "8080"], timeout=30).stdout.strip()
        # e.g. "127.0.0.1:53219" (possibly multiple lines) -> take the first host port.
        host_port = port_line.splitlines()[0].rsplit(":", 1)[1]
        base_url = f"http://127.0.0.1:{host_port}"
        if not _wait_healthy(base_url):
            logs = _run(["docker", "logs", name], timeout=30).stdout[-500:]
            raise SandboxUnavailable(f"target did not become healthy; logs tail: {logs}")
        yield Target(base_url=base_url, container=name)
    finally:
        _run(["docker", "rm", "-f", name], timeout=60)
        _run(["docker", "rmi", "-f", tag], timeout=60)


def run_check(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    """Run a trusted verifier command (an exploit/functional script) on the host.

    Returns (exit_code, combined stdout+stderr). A timeout is reported as code 124.
    """
    try:
        proc = _run(cmd, timeout=timeout)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timeout"
