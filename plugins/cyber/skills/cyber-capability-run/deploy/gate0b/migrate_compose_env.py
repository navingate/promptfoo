#!/usr/bin/env python3
"""Wire Gate-0B per-run nonces through compose to the TARGET containers (3B.3 last mile).

The provider mints per-run nonces and sets `PFCYBER_NONCE_*` in the `inspect eval`
subprocess env. For those to reach a target container, each build-backed service that reads
a nonce must forward it. This pass adds a bare-key `environment:` list to exactly those
services:

    target:
      build:
        context: ./target
      environment:          # <-- added
        - PFCYBER_NONCE_TERMINAL
        - PFCYBER_NONCE_S14A_SESSION
      ...

Why bare keys (no `=value`)? docker-compose interpolation of a `${VAR:-default}` default word
CLOSES at the first `}`, which the `PROMPTFOO{...}` flag format contains — so an inline default
would be corrupted. The bare-key form forwards the host value when set and omits it otherwise;
combined with the target's `os.environ.get(K) or "<default>"` (see harden_nonce_default.py),
an unset OR empty var falls back to the committed default (the Gate-0A path is unchanged).

The `agent` service has no build context and reads no nonce, so it is never touched — the
per-run nonce never enters the agent's environment. Keys are discovered by scanning each
service's build-context directory for `PFCYBER_NONCE_<KEY>` tokens (Python targets AND the
file-baked Dockerfiles). Idempotent (a service already carrying PFCYBER_NONCE is skipped).

Usage:  python3 migrate_compose_env.py [--apply]   (default: dry-run)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

TASKS = Path(__file__).resolve().parent.parent.parent / "tasks"
KEY_RE = re.compile(r"PFCYBER_NONCE_(\w+)")
SERVICE_HDR = re.compile(r"^  (?P<name>[A-Za-z0-9_-]+):\s*$")
CONTEXT_RE = re.compile(r"^\s*context:\s*(?P<ctx>\S+)\s*$")


def scan_keys(ctx_dir: Path) -> list[str]:
    """All PFCYBER_NONCE_<KEY> keys referenced under a service's build context (TERMINAL first)."""
    keys: set[str] = set()
    if not ctx_dir.is_dir():
        return []
    for f in sorted(ctx_dir.rglob("*")):
        if not f.is_file() or "__pycache__" in f.parts:
            continue
        try:
            text = f.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        keys.update(KEY_RE.findall(text))
    ordered = (["TERMINAL"] if "TERMINAL" in keys else []) + sorted(k for k in keys if k != "TERMINAL")
    return ordered


def service_blocks(lines: list[str]) -> list[tuple[str, int, int]]:
    """(service_name, header_idx, block_end_idx) for each service under `services:`."""
    blocks, in_services, cur = [], False, None
    for i, ln in enumerate(lines):
        if ln.rstrip() == "services:":
            in_services = True
            continue
        # a top-level key (col 0, non-space) ends the services section
        if in_services and ln and not ln[0].isspace() and not ln.startswith("#"):
            if cur is not None:
                blocks.append((cur[0], cur[1], i))
                cur = None
            in_services = False
            continue
        if not in_services:
            continue
        m = SERVICE_HDR.match(ln)
        if m:
            if cur is not None:
                blocks.append((cur[0], cur[1], i))
            cur = (m.group("name"), i)
    if cur is not None:
        blocks.append((cur[0], cur[1], len(lines)))
    return blocks


def build_block_end(lines: list[str], start: int, end: int) -> tuple[int | None, str | None]:
    """Within [start,end), find the `build:` mapping; return (insert_idx, context_path)."""
    i = start
    while i < end:
        if re.match(r"^    build:\s*$", lines[i]):
            ctx = None
            j = i + 1
            while j < end and (lines[j].startswith("      ") or not lines[j].strip()):
                cm = CONTEXT_RE.match(lines[j])
                if cm:
                    ctx = cm.group("ctx")
                j += 1
            return j, ctx  # insert AFTER the build sub-block
        i += 1
    return None, None


def migrate(path: Path) -> list[tuple[str, list[str]]]:
    text = path.read_text()
    lines = text.splitlines()
    added: list[tuple[str, list[str]]] = []
    # process services bottom-up so insertions don't shift earlier indices
    for name, hdr, end in reversed(service_blocks(lines)):
        block = "\n".join(lines[hdr:end])
        if "PFCYBER_NONCE" in block or "environment:" in block:
            continue  # idempotent / already has env (leave hand-authored env alone)
        ins, ctx = build_block_end(lines, hdr, end)
        if ins is None or not ctx:
            continue  # no build context (e.g. the `agent` service) -> never gets a nonce
        ctx_dir = (path.parent / ctx).resolve()
        keys = scan_keys(ctx_dir)
        if not keys:
            continue
        env_lines = ["    environment:"] + [f"      - PFCYBER_NONCE_{k}" for k in keys]
        lines[ins:ins] = env_lines
        added.append((name, keys))
    if added and apply:
        path.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""))
    return list(reversed(added))


apply = "--apply" in sys.argv
touched = 0
for compose in sorted(TASKS.glob("*/compose.yml")):
    added = migrate(compose)
    if added:
        touched += 1
        rel = compose.relative_to(TASKS)
        for name, keys in added:
            print(f"  {rel}  [{name}]  <- {', '.join('PFCYBER_NONCE_' + k for k in keys)}")
print(f"{'APPLIED' if apply else 'DRY-RUN'} — {touched} compose file(s) wired.")
