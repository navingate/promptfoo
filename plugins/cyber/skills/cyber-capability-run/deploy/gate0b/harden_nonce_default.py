#!/usr/bin/env python3
"""Harden migrated targets against an EMPTY injected nonce (Gate-0B compose passthrough).

`migrate_nonces.py` emitted `os.environ.get("PFCYBER_NONCE_X", "<default>")`. That returns
the committed default only when the key is ABSENT — but some docker-compose versions, given
a bare-key `environment: [PFCYBER_NONCE_X]` whose host value is unset, inject the key with an
EMPTY string rather than omitting it. `get(key, default)` then returns "" and the target
serves an empty flag, silently breaking the Gate-0A path.

This pass rewrites those to treat empty-as-absent:

    os.environ.get("PFCYBER_NONCE_X", "<default>")
      ->  (os.environ.get("PFCYBER_NONCE_X") or "<default>")

so the target falls back to the committed default whether the key is unset OR empty. A real
per-run nonce is never empty, so the injected path is unaffected. The parens keep precedence
safe if the expression is ever embedded. Idempotent (skips lines already using `or`).

Usage:  python3 harden_nonce_default.py [--apply]   (default: dry-run)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

TASKS = Path(__file__).resolve().parent.parent.parent / "tasks"

# os.environ.get("PFCYBER_NONCE_<KEY>", "<PROMPTFOO{...}>")  ->  (os.environ.get(...) or "...")
GET = re.compile(
    r'os\.environ\.get\(\s*'
    r'(?P<key>"PFCYBER_NONCE_\w+")\s*,\s*'
    r'(?P<default>"PROMPTFOO\{[^"]*\}"|\'PROMPTFOO\{[^\']*\}\')\s*\)'
)


def _sub(m: re.Match) -> str:
    return f"(os.environ.get({m.group('key')}) or {m.group('default')})"


def harden_file(path: Path) -> int:
    text = path.read_text()
    if "PFCYBER_NONCE_" not in text:
        return 0
    new, n = GET.subn(_sub, text)
    if n and apply:
        path.write_text(new)
    return n


apply = "--apply" in sys.argv
touched, total = [], 0
for py in sorted(TASKS.rglob("*.py")):
    n = harden_file(py)
    if n:
        touched.append((str(py.relative_to(TASKS)), n))
        total += n

print(f"{'APPLIED' if apply else 'DRY-RUN'} — hardened {total} default(s) across {len(touched)} file(s):")
for f, n in touched:
    print(f"  {n}x  {f}")
