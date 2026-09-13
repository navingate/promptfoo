#!/usr/bin/env python3
"""Migrate authored targets to per-run nonces (Gate-0B env-or-default).

For every authored task, rewrites the flag/marker CONSTANTS in its target service(s) so
they read an injected per-run nonce with the committed value as a fallback:

    FLAG = "PROMPTFOO{...}"
      ->  FLAG = os.environ.get("PFCYBER_NONCE_TERMINAL", "PROMPTFOO{...}")
    SUBTASK_X = "PROMPTFOO{s2a_identity_ok}"        (a non-terminal stage marker)
      ->  SUBTASK_X = os.environ.get("PFCYBER_NONCE_S2A_IDENTITY", "PROMPTFOO{...}")

Keys come from the task's eval.yml: the flag (and the terminal subtask marker, which
equals it) map to TERMINAL; each non-terminal subtask marker maps to its subtask id. The
Gate-0B provider mints a nonce per key and injects PFCYBER_NONCE_<KEY> into the TARGET's
env, so the same image serves a different flag every run (see references/gate-0b-verifier.md).
Backward compatible: with no env injected, the committed default is used (Gate-0A path).

Idempotent. Requires PyYAML (present in the harness/provider env). Prints a summary.
Usage:  python3 migrate_nonces.py [--apply]   (default: dry-run)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

TASKS = Path(__file__).resolve().parent.parent.parent / "tasks"
ASSIGN = re.compile(r'^(?P<indent>\s*)(?P<name>[A-Za-z_]\w*)\s*=\s*(?P<q>["\'])(?P<val>PROMPTFOO\{[^"\']*\})(?P=q)(?P<tail>\s*(#.*)?)$')


def _mapping(doc: dict) -> dict[str, str]:
    flag = doc.get("flag")
    mp: dict[str, str] = {}
    if flag:
        mp[flag] = "TERMINAL"
    for s in (doc.get("metadata", {}) or {}).get("subtasks", []) or []:
        marker, sid = s.get("marker"), s.get("id")
        if not marker or not sid:
            continue
        mp[marker] = "TERMINAL" if marker == flag else sid.upper()
    return mp


def _ensure_import_os(lines: list[str]) -> list[str]:
    if any(re.match(r"^\s*import os\b", ln) or re.match(r"^\s*import os,", ln) for ln in lines):
        return lines
    # insert after the first import line (keeps import block tidy)
    for i, ln in enumerate(lines):
        if re.match(r"^(import |from )\S", ln):
            return lines[:i] + ["import os"] + lines[i:]
    return ["import os"] + lines


def migrate_file(path: Path, mp: dict[str, str]) -> int:
    text = path.read_text()
    lines = text.splitlines()
    changed = 0
    out = []
    for ln in lines:
        m = ASSIGN.match(ln)
        if m and m.group("val") in mp and "os.environ.get" not in ln:
            key = mp[m.group("val")]
            out.append(
                f'{m.group("indent")}{m.group("name")} = os.environ.get('
                f'"PFCYBER_NONCE_{key}", {m.group("q")}{m.group("val")}{m.group("q")}){m.group("tail")}'
            )
            changed += 1
        else:
            out.append(ln)
    if changed:
        out = _ensure_import_os(out)
        if apply:
            path.write_text("\n".join(out) + ("\n" if text.endswith("\n") else ""))
    return changed


apply = "--apply" in sys.argv
touched, total = [], 0
for ev in sorted(TASKS.glob("*/eval.yml")):
    doc = yaml.safe_load(ev.read_text())
    if not isinstance(doc, dict):
        continue
    mp = _mapping(doc)
    if not mp:
        continue
    for py in sorted(ev.parent.rglob("app.py")):
        n = migrate_file(py, mp)
        if n:
            touched.append((str(py.relative_to(TASKS)), n))
            total += n

print(f"{'APPLIED' if apply else 'DRY-RUN'} — {total} constant(s) across {len(touched)} file(s):")
for f, n in touched:
    print(f"  {n}x  {f}")
# Report tasks whose flag lives outside a Python constant (need per-task handling).
for ev in sorted(TASKS.glob("*/eval.yml")):
    doc = yaml.safe_load(ev.read_text())
    if not isinstance(doc, dict) or not doc.get("flag"):
        continue
    flag = doc["flag"]
    apps = list(ev.parent.rglob("app.py"))
    if apps and not any(flag in p.read_text() for p in apps):
        print(f"  NOTE: {ev.parent.name} — flag not a Python constant (e.g. baked in Dockerfile); per-task nonce handling needed")
