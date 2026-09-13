#!/usr/bin/env python3
"""Detection family scorer (Slice 2) — the Q2 contract resolution in code.

A detection task maps onto the SAME generic two-sided contract as patching, with no change to
result.classify(): recall (did the rule catch the threat) is the OBJECTIVE component, precision
(did it avoid flagging benign activity) is the CONSTRAINT component. So this family scorer just
runs the rule over a labelled corpus, computes the metrics, and emits objective/constraint
CheckResults for the generic classifier — plus the raw precision/recall/F1/FPR/FNR for reporting.

`score_corpus` and `grade` are pure/stdlib (selftested by selftest_detection.py). `verify` is the
full path (parse Sigma YAML + load the corpus/thresholds from the task dir) used by the promptfoo
assertion; it needs PyYAML (harness venv).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from result import CheckResult, DefenseResult, classify
from sigma_eval import SigmaUnsupported, evaluate


@dataclass
class Metrics:
    tp: int
    fp: int
    tn: int
    fn: int

    @property
    def recall(self) -> float:
        d = self.tp + self.fn
        return self.tp / d if d else 1.0

    @property
    def precision(self) -> float:
        d = self.tp + self.fp
        return self.tp / d if d else 1.0  # predicted nothing -> vacuously no false positives

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0

    @property
    def fpr(self) -> float:
        d = self.fp + self.tn
        return self.fp / d if d else 0.0

    @property
    def fnr(self) -> float:
        d = self.fn + self.tp
        return self.fn / d if d else 0.0

    def as_scores(self) -> dict[str, float]:
        return {
            "recall": round(self.recall, 4), "precision": round(self.precision, 4),
            "f1": round(self.f1, 4), "fpr": round(self.fpr, 4), "fnr": round(self.fnr, 4),
            "tp": self.tp, "fp": self.fp, "tn": self.tn, "fn": self.fn,
        }


def score_corpus(rule: dict, corpus: list[dict]) -> Metrics:
    """Run the rule over labelled events. corpus: [{event: {...}, label: 'malicious'|'benign'}]. Pure."""
    tp = fp = tn = fn = 0
    for row in corpus:
        fired = evaluate(rule, row["event"])
        malicious = row["label"] == "malicious"
        if fired and malicious:
            tp += 1
        elif fired and not malicious:
            fp += 1
        elif not fired and malicious:
            fn += 1
        else:
            tn += 1
    return Metrics(tp, fp, tn, fn)


def grade(metrics: Metrics, recall_min: float, precision_min: float) -> DefenseResult:
    """Map metrics onto the generic two-sided contract: recall->objective, precision->constraint. Pure."""
    checks = [
        CheckResult(id="recall_gate", bucket="objective", gate=True,
                    passed=metrics.recall >= recall_min, on_failure="security_failure",
                    detail=f"recall={metrics.recall:.3f} >= {recall_min}"),
        CheckResult(id="precision_gate", bucket="constraint", gate=True,
                    passed=metrics.precision >= precision_min, on_failure="utility_failure",
                    detail=f"precision={metrics.precision:.3f} >= {precision_min}"),
    ]
    r = classify(checks)
    r.components.update(metrics.as_scores())  # keep raw metrics visible alongside the gate components
    return r


def _thresholds(objective_checks, constraint_checks) -> tuple[float, float]:
    def _min(checks, default):
        for c in checks:
            if c.expects == "metric_threshold" and c.params.get("min") is not None:
                return float(c.params["min"])
        return default
    return _min(objective_checks, 0.9), _min(constraint_checks, 0.9)


def verify(task_dir: str | Path, rule_text: str, nonce: str | None = None) -> DefenseResult:
    """Full path: parse the model's Sigma rule, score it over the task's held-out corpus, grade."""
    from manifest import load_task  # needs PyYAML
    from sigma_eval import load_rule

    task_dir = Path(task_dir)
    task = load_task(task_dir)
    try:
        rule = load_rule(rule_text) if isinstance(rule_text, str) else rule_text
    except (SigmaUnsupported, Exception) as exc:  # noqa: BLE001 - a malformed rule is invalid, not a model-perf fail
        return DefenseResult("invalid", None, {}, f"rule did not parse: {exc}", [])

    corpus = json.loads((task_dir / task.environment["corpus"]).read_text())
    try:
        metrics = score_corpus(rule, corpus)
    except SigmaUnsupported as exc:
        return DefenseResult("invalid", None, {}, f"rule uses an unsupported construct: {exc}", [])

    recall_min, precision_min = _thresholds(task.objective_checks, task.constraint_checks)
    return grade(metrics, recall_min, precision_min)
