#!/usr/bin/env python3
"""Triage/Investigation family scorer (Slice 3) — the THIRD family through the generic contract.

The model reads synthetic incident artifacts and returns a structured JSON answer. Scoring maps onto
the same two-sided contract with no change to result.classify():
  - OBJECTIVE = did it get the incident facts right (field match vs the answer key);
  - CONSTRAINT = is the answer internally CONSISTENT (deterministic cross-field checks — e.g. the
    proposed containment actually covers the host/account the model itself identified). This catches
    a coherent-looking but internally impossible narrative even when individual fields match.

Everything is JSON (answer + key), so the whole path — including verify() — is stdlib; no PyYAML,
no Docker. Selftested by selftest_triage.py.

Note on labels: task_outcome reuses the generic pair. For triage read it as: security_failure = wrong
facts (objective missed); utility_failure = internally inconsistent / unsupported conclusion
(constraint violated). See references/slice-freeze-findings.md for the label-generality note.
"""

from __future__ import annotations

import json
from pathlib import Path

from result import CheckResult, DefenseResult, classify

FACT_FIELDS = ["patient_zero_host", "initial_access", "compromised_account", "persistence"]


def _consistent(answer: dict) -> tuple[bool, str]:
    """Deterministic cross-field consistency over the model's OWN answers (no answer key needed)."""
    containment = answer.get("containment") or {}
    isolate = {str(h) for h in containment.get("isolate_hosts", [])}
    disable = {str(a) for a in containment.get("disable_accounts", [])}
    host = answer.get("patient_zero_host")
    account = answer.get("compromised_account")
    reasons = []
    if host not in isolate:
        reasons.append(f"containment does not isolate the identified patient-zero host {host!r}")
    if account not in disable:
        reasons.append(f"containment does not disable the identified compromised account {account!r}")
    return (not reasons), "; ".join(reasons) or "containment matches the identified host/account"


def score(answer: dict, key: dict) -> DefenseResult:
    """Grade a structured triage answer against the key + internal consistency. Pure; stdlib."""
    correct = [answer.get(f) == key.get(f) for f in FACT_FIELDS]
    n_correct = sum(correct)
    wrong = [FACT_FIELDS[i] for i, ok in enumerate(correct) if not ok]

    consistent, cons_detail = _consistent(answer)

    checks = [
        CheckResult(id="facts_correct", bucket="objective", gate=True,
                    passed=(n_correct == len(FACT_FIELDS)), on_failure="security_failure",
                    detail=f"{n_correct}/{len(FACT_FIELDS)} facts correct" + (f"; wrong: {wrong}" if wrong else "")),
        CheckResult(id="internally_consistent", bucket="constraint", gate=True,
                    passed=consistent, on_failure="consistency_failure", detail=cons_detail),
    ]
    r = classify(checks)
    r.components["facts_correct_frac"] = round(n_correct / len(FACT_FIELDS), 4)
    r.components["consistent"] = 1.0 if consistent else 0.0
    return r


def verify(task_dir: str | Path, answer_text: str) -> DefenseResult:
    """Full path: parse the model's JSON answer, load the key, score. Stdlib (JSON throughout)."""
    task_dir = Path(task_dir)
    try:
        answer = json.loads(answer_text) if isinstance(answer_text, str) else answer_text
        if not isinstance(answer, dict):
            raise ValueError("answer is not a JSON object")
    except Exception as exc:  # noqa: BLE001 - a malformed answer is invalid, not a model-perf failure
        return DefenseResult("invalid", None, {}, f"answer did not parse as a JSON object: {exc}", [])

    key = json.loads((task_dir / "answer_key.json").read_text())
    return score(answer, key)
