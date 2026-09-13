#!/usr/bin/env python3
"""Run-level provenance manifest — bind a published capability number to the EXACT inputs that
produced it, so a result is reproducible and auditable.

The per-attempt manifest (manifest.py) records the decision; the release manifest
(release_manifest.py) digests the committed suite. This record binds a specific RUN to its provenance:

  * suite_digest   — the release manifest_digest (content-addressed "benchmark version")
  * git            — HEAD of the tree that produced the run (+ a dirty flag), or explicit absence
  * model          — the model under test
  * scoring_mode   — how captures are counted (default "strict": flag submitted as the final answer)
  * spec_sha256    — SHA-256 of the instance spec (PFCYBER_F2_SPEC); pins the exact generated instance
                     without exporting it
  * images         — built container image digests when docker is available, else recorded absent
  * generated_at   — UTC timestamp

Carries digests/commitments only (no flag values, no raw spec) and is passed through manifest.redact
as a final guard, so it provably exports no recoverable secret. Pure stdlib; `--selftest` exercises the
core; the CLI emits a real record.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SKILL = _HERE.parent.parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _git(cwd: Path) -> dict:
    def run(args):
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10)
    try:
        head = run(["rev-parse", "HEAD"])
        if head.returncode != 0:
            return {"commit": None, "note": "not a git checkout"}
        dirty = run(["status", "--porcelain"]).stdout.strip() != ""
        return {"commit": head.stdout.strip(), "dirty": dirty}
    except (OSError, subprocess.SubprocessError):
        return {"commit": None, "note": "git unavailable"}


def _spec_sha(spec_json: str | None) -> str | None:
    if not spec_json:
        return None
    return "sha256:" + hashlib.sha256(spec_json.encode()).hexdigest()


def _image_digests() -> dict:
    """{ref: digest} for local images when docker is available; else an explicit absence marker."""
    try:
        p = subprocess.run(
            ["docker", "images", "--digests", "--format", "{{.Repository}}:{{.Tag}} {{.Digest}}"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return {"available": False, "note": "docker not available in this environment"}
    if p.returncode != 0:
        return {"available": False, "note": "docker not available in this environment"}
    digests = {}
    for line in p.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] not in ("<none>", ""):
            digests[parts[0]] = parts[1]
    return {"available": True, "digests": digests}


def build_run_manifest(*, model: str | None, scoring_mode: str = "strict",
                       spec_json: str | None = None, suite_digest: str | None = None,
                       image_digests: dict | None = None, skill: Path = _SKILL) -> dict:
    """Assemble the run-provenance record (redacted). Pass suite_digest/image_digests to avoid the
    (slower / docker-dependent) auto-collection — the CLI computes them for real."""
    manifest = _load("pfcyber_manifest", "manifest.py")
    if suite_digest is None:
        rel = _load("pfcyber_release_manifest", "release_manifest.py")
        suite_digest = rel.build(rel.collect(skill))["manifest_digest"]
    rec = {
        "schema": "gate0b-run/1",
        "suite_digest": suite_digest,
        "git": _git(skill),
        "model": model,
        "scoring_mode": scoring_mode,
        "spec_sha256": _spec_sha(spec_json),
        "images": image_digests if image_digests is not None else _image_digests(),
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return manifest.redact(rec)


def _selftest():
    spec = json.dumps({"seed": 7, "account": "svc-x"}, sort_keys=True)
    m = build_run_manifest(model="openai/glm-5.3", spec_json=spec,
                           suite_digest="deadbeef", image_digests={"available": False})
    assert m["schema"] == "gate0b-run/1", m
    assert m["scoring_mode"] == "strict", m
    assert m["model"] == "openai/glm-5.3", m
    assert m["spec_sha256"] == "sha256:" + hashlib.sha256(spec.encode()).hexdigest(), m
    assert m["suite_digest"] == "deadbeef", m
    assert "git" in m and "commit" in m["git"], m
    # a proof token anywhere in the inputs is committed, never exported verbatim
    leaky = build_run_manifest(model="PROMPTFOO{oops}", spec_json='{"x":"PROMPTFOO{secret}"}',
                               suite_digest="d", image_digests={"available": False})
    assert "PROMPTFOO{secret}" not in json.dumps(leaky), "raw proof token leaked into run manifest"
    assert "PROMPTFOO{oops}" not in json.dumps(leaky), "raw proof token leaked via model field"
    # real (auto) collection produces a suite_digest + a git block for this actual tree
    real = build_run_manifest(model="m", image_digests={"available": False})
    assert isinstance(real["suite_digest"], str) and len(real["suite_digest"]) == 64, real["suite_digest"]
    print("run_manifest selftest OK — schema, strict scoring mode, spec hash, redaction, "
          "git block, real suite digest")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--model", default=os.environ.get("CYBER_MODEL"))
    ap.add_argument("--scoring-mode", default="strict")
    a = ap.parse_args()
    if a.selftest:
        _selftest()
        sys.exit(0)
    print(json.dumps(build_run_manifest(model=a.model, scoring_mode=a.scoring_mode,
                                        spec_json=os.environ.get("PFCYBER_F2_SPEC")), indent=2))
