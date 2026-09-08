#!/usr/bin/env python3
"""Correlation-detector scorer (Slice 6b) — the SCORED federation slice.

Runs a correlation rule over the defender telemetry, flags incidents, and grades against the
evaluator-only ground truth through the SAME frozen two-sided contract as Slice 2: per-incident
recall → objective, precision → constraint, generic result.classify(). Pure/stdlib apart from the
YAML/JSON rule parse (JSON here; the promptfoo path also accepts YAML in the harness venv).
"""

from __future__ import annotations

import json
from pathlib import Path

from correlation_eval import CorrelationUnsupported, flagged_incidents
from result import DefenseResult
from verify_detection import Metrics, grade


def score_corpus(rule: dict, events: list[dict], ground_truth: dict[str, str]) -> Metrics:
    """Per-INCIDENT confusion counts: an incident is malicious per the ground-truth ledger; the rule
    flags a set of incident keys. Pure."""
    flagged = flagged_incidents(rule, events)
    tp = fp = tn = fn = 0
    for key, label in ground_truth.items():
        malicious = label == "malicious"
        fired = key in flagged
        if fired and malicious:
            tp += 1
        elif fired and not malicious:
            fp += 1
        elif not fired and malicious:
            fn += 1
        else:
            tn += 1
    return Metrics(tp, fp, tn, fn)


def verify(task_dir: str | Path, rule_text, nonce: str | None = None) -> DefenseResult:
    """Full path: parse the model's correlation rule, score over the task's corpus + ground truth."""
    task_dir = Path(task_dir)
    try:
        rule = json.loads(rule_text) if isinstance(rule_text, str) else rule_text
        if not isinstance(rule, dict):
            raise ValueError("rule is not an object")
    except Exception as exc:  # noqa: BLE001 - a malformed rule is invalid, not a model-perf failure
        return DefenseResult("invalid", None, {}, f"rule did not parse: {exc}", [])

    events = json.loads((task_dir / "corpus.json").read_text())
    ground_truth = json.loads((task_dir / "ground_truth.json").read_text())
    try:
        metrics = score_corpus(rule, events, ground_truth)
    except CorrelationUnsupported as exc:
        return DefenseResult("invalid", None, {}, f"rule uses an unsupported construct: {exc}", [])

    # thresholds: catch every smuggling incident, tolerate zero false alarms on this clean corpus.
    return grade(metrics, recall_min=1.0, precision_min=1.0)
