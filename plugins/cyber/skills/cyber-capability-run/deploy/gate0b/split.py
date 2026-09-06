#!/usr/bin/env python3
"""4D.2 — public-dev / private-scored split.

Per-run nonces already resist FLAG memorization (each run mints a fresh flag). The held-out split
adds a second layer: STRUCTURE memorization. The public-dev set is published in full (tasks +
solutions) for methodology and development; a private-scored set is kept back — never published with
its structure or solutions — and rotated, so a published capability number can cite both a
nonce-resisted public score and a structure-resisted private score.

This module holds the split POLICY logic: every task is classified exactly once, and the public
release descriptor lists public tasks in full while representing private tasks by a
commitment (digest) only — proving they exist without revealing them. Pure stdlib; self-tested.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SKILL = _HERE.parent.parent
POLICY_PATH = _HERE / "split.policy.json"


def validate(task_ids: list[str], policy: dict) -> list[str]:
    """Return policy problems. Disposition is default `public_dev`; only `private_scored` is listed
    explicitly (so a new task can never be silently unclassified). Every private id must exist."""
    problems = []
    if policy.get("default", "public_dev") not in ("public_dev", "private_scored"):
        problems.append(f"unknown default disposition: {policy.get('default')!r}")
    private = set(policy.get("private_scored", []))
    unknown = private - set(task_ids)
    if unknown:
        problems.append(f"policy names non-existent tasks: {sorted(unknown)}")
    return problems


def public_release(task_ids: list[str], policy: dict, digest_of=None) -> dict:
    """The published release descriptor: public tasks named; private tasks as commitments only.
    Unlisted tasks take the policy `default` (public_dev), so the set is complete by construction."""
    default = policy.get("default", "public_dev")
    private_set = set(policy.get("private_scored", []))
    private = [t for t in task_ids if t in private_set or (default == "private_scored" and t not in set(policy.get("public_dev", [])))]
    public = [t for t in task_ids if t not in set(private)]
    df = digest_of or (lambda t: "sha256:" + hashlib.sha256(t.encode()).hexdigest()[:16])
    return {
        "public_dev": sorted(public),
        "private_scored_commitments": {t: df(t) for t in sorted(private)},
        "counts": {"public": len(public), "private": len(private)},
    }


def _task_ids(skill: Path = _SKILL) -> list[str]:
    return sorted(p.name for p in (skill / "tasks").glob("*") if p.is_dir() and p.name != "_smoke")


if __name__ == "__main__":
    ids = _task_ids()
    policy = json.loads(POLICY_PATH.read_text()) if POLICY_PATH.exists() else {"public_dev": ids, "private_scored": []}
    problems = validate(ids, policy)
    if problems:
        for p in problems:
            print(f"POLICY PROBLEM: {p}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(public_release(ids, policy), indent=2))
