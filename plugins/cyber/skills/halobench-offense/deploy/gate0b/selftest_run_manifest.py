#!/usr/bin/env python3
"""CI self-test for run_manifest.py — exercises the run-level provenance record (schema, strict
scoring mode, spec hash, git block, real suite digest, and no-secret redaction). Exits non-zero on
failure so ci_gate0b.py counts it as a criterion. Pure stdlib."""
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("run_manifest", HERE / "run_manifest.py")
_mod = importlib.util.module_from_spec(_spec)
sys.modules["run_manifest"] = _mod
_spec.loader.exec_module(_mod)

_mod._selftest()
