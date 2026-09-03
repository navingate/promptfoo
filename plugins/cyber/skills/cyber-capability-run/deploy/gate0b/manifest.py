#!/usr/bin/env python3
"""Gate-0B run manifest + secret/proof-token redaction (3B.5 sanitization / 3B.8 manifest).

Two jobs:

  1. redact(obj) — recursively strip every proof token and secret from an arbitrary structure
     before it can reach a log, the UI, or an exported artifact. A `PROMPTFOO{...}` token (a live
     per-run nonce OR a committed default flag) is replaced by a NON-reversible commitment
     `‹proof-token:sha256:<12hex>›`, so a reader can still tell two runs apart and match a later
     disclosure without ever seeing the token. Values under nonce/secret/credential-shaped keys
     are replaced by `‹redacted›`.

  2. build_manifest(result, ...) — assemble the exported run manifest from a provider result:
     the decision-relevant fields (task, model, outcome, captured, verify/invalid reason,
     per-stage credit, timing, controls) PLUS a `nonce_commitments` map (stage -> sha256[:12] of
     the per-run nonce) that proves which nonces were in play — all passed through redact(), so
     the manifest provably carries no recoverable secret.

Pure stdlib. See references/gate-0b-verifier.md and build-plan 3B.5/3B.8.
"""
from __future__ import annotations

import hashlib
import re

PROOF_RE = re.compile(r"PROMPTFOO\{[^}]*\}")
# keys whose VALUES are secrets/proof material and must never be exported verbatim
_SECRET_KEY_RE = re.compile(
    r"(pfcyber_nonce|pfcyber_default|_nonce$|secret|password|passwd|api[_-]?key|token|"
    r"authorization|cookie|private[_-]?key)",
    re.IGNORECASE,
)


def commit(token: str) -> str:
    """Non-reversible commitment to a proof token (prove-which without revealing)."""
    return "sha256:" + hashlib.sha256(token.encode()).hexdigest()[:12]


def _redact_str(s: str) -> str:
    return PROOF_RE.sub(lambda m: f"‹proof-token:{commit(m.group(0))}›", s)


def redact(obj, _key: str | None = None):
    """Deep-copy `obj` with all proof tokens committed and secret-keyed values masked."""
    if isinstance(obj, dict):
        return {k: redact(v, _key=str(k)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [redact(v, _key=_key) for v in obj]
    if isinstance(obj, str):
        if _key is not None and _SECRET_KEY_RE.search(_key):
            # a secret-keyed value: mask entirely, but keep a commitment if it is a proof token
            return f"‹redacted:{commit(obj)}›" if PROOF_RE.search(obj) else "‹redacted›"
        return _redact_str(obj)
    return obj  # numbers / bool / None pass through


# Fields carried into the exported manifest (decision-relevant, non-secret).
_MANIFEST_FIELDS = (
    "task", "benchmark", "model", "outcome", "captured", "score", "elapsed_s",
    "verify_reason", "invalid_reason", "flag_via_tool",
    "subtasks_passed", "subtasks_total", "subtask_fraction", "difficulty",
)


def build_manifest(result: dict, *, broker_run_id: str | None = None,
                   nonces: dict | None = None, controls: dict | None = None) -> dict:
    """Build the redacted run manifest from a provider result dict.

    `nonces` (stage -> nonce) becomes `nonce_commitments` (stage -> sha256[:12]); the raw nonces
    are never copied in. Everything is passed through redact() as a belt-and-suspenders final
    pass, so even an unexpected token in a subtask label or reason cannot leak.
    """
    meta = (result or {}).get("metadata", {}) or {}
    man: dict = {"run_id": broker_run_id}
    for f in _MANIFEST_FIELDS:
        if f in meta:
            man[f] = meta[f]
    # per-stage credit WITHOUT the markers (label + credited only)
    stages = meta.get("subtasks") or []
    if stages:
        man["subtasks"] = [{"id": s.get("id"), "label": s.get("label"),
                            "credited": bool(s.get("credited"))} for s in stages]
    if nonces:
        man["nonce_commitments"] = {stage: commit(n) for stage, n in nonces.items()}
    if controls is not None:
        man["controls"] = controls
    return redact(man)
