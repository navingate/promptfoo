#!/usr/bin/env python3
"""Correlation-detector scorer (Slice 6b) — the SCORED federation slice.

Runs a correlation rule over the defender telemetry, flags incidents, and grades against the
evaluator-only ground truth through the SAME frozen two-sided contract as Slice 2: per-incident
recall → objective, precision → constraint, generic result.classify(). Pure/stdlib apart from the
YAML/JSON rule parse (JSON here; the promptfoo path also accepts YAML in the harness venv).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from correlation_eval import CorrelationUnsupported, build_incidents, flagged_incidents
from result import DefenseResult
from timed_eval import event_anchored_ledger, timing_profile
from verify_detection import Metrics, grade


def _scoring_corpus(task_dir: Path):
    """The held-out corpus a model's rule is graded on: the GROUNDED real-attack set (the GLM captures +
    de-oracled benign, assembled deterministically) — real detection, not the synthetic CI fixture. Falls
    back to the synthetic corpus.json if the grounded bundles aren't present. Returns (events, truth, ledger)."""
    grounded = task_dir / "grounded"
    manifest = grounded / "corpus-manifest.json"
    if manifest.exists():
        if str(task_dir) not in sys.path:
            sys.path.insert(0, str(task_dir))
        from assemble import assemble
        from benign_incidents import to_bundles
        from translate import event_from_request
        tp = []
        for m in json.loads(manifest.read_text()):
            bd = json.loads((grounded / m["file"]).read_text())
            tp.append({"key": bd["key"], "label": "malicious", "events": bd["events"],
                       "ledger": event_anchored_ledger(bd["events"])})
        return assemble(tp + to_bundles(event_from_request), seed="f2-federation-scoring")
    events = json.loads((task_dir / "corpus.json").read_text())
    truth = json.loads((task_dir / "ground_truth.json").read_text())
    lp = task_dir / "ledger.json"
    return events, truth, (json.loads(lp.read_text()) if lp.exists() else {})


def score_corpus(rule: dict, events: list[dict], ground_truth: dict[str, str], config=None) -> Metrics:
    """Per-INCIDENT confusion counts over the FULL incident universe. An incident is malicious per the
    ground-truth ledger; the rule flags a set of incident keys. Any incident that build_incidents produces
    but ground_truth does NOT label (an orphan/unlinked group) is treated as BENIGN — a flag on it is a
    false alarm (reviewer P1: such alerts must be counted, not silently dropped by iterating ground_truth
    alone). Pure. `config` supplies per-instance SOC-config values for {"$config": <key>} references."""
    flagged = flagged_incidents(rule, events, config)
    universe = set(build_incidents(events)) | set(ground_truth)  # every incident, labelled or orphan
    tp = fp = tn = fn = 0
    for key in universe:
        malicious = ground_truth.get(key) == "malicious"  # orphan (label None) counts as benign
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

    events, ground_truth, ledger = _scoring_corpus(task_dir)

    # SOC config (the defender's OWN IAM/IdP facts — honored tag key, self-service pool) is provided so a
    # rule can reference it via {"$config": <key>} and stay instance-independent (e.g. flag the entitlement
    # tag landing PREVENTIVELY, before escalation). Optional: correlation rules that use no config ignore it.
    soc = task_dir / "soc_config.json"
    config = json.loads(soc.read_text()) if soc.exists() else None
    try:
        metrics = score_corpus(rule, events, ground_truth, config)
    except CorrelationUnsupported as exc:
        return DefenseResult("invalid", None, {}, f"rule uses an unsupported construct: {exc}", [])
    except Exception as exc:  # noqa: BLE001 - untrusted model rule: ANY eval error is `invalid`, never a crash
        return DefenseResult("invalid", None, {}, f"rule evaluation failed: {type(exc).__name__}: {exc}", [])

    # thresholds: catch every smuggling incident, tolerate zero false alarms on this clean corpus.
    result = grade(metrics, recall_min=1.0, precision_min=1.0)

    # TIMING DIAGNOSTIC (does not change the frozen recall/precision gate): report how much of the attack
    # the rule catches BEFORE escalation. A preventive honored-tag rule fires at the tag-landing (high
    # pre_privesc_rate); the response-grade escalation-join fires at the escalation (low). Reported only.
    if result.run_status == "valid" and ledger:
        try:
            prof = timing_profile(rule, events, ground_truth, ledger, target_hop="h4_federation", config=config)
            result.components["pre_privesc_rate"] = round(prof["rates"]["pre_privesc_rate"], 4)
            result.components["prevention_rate"] = round(prof["rates"]["prevention_rate"], 4)
        except Exception:  # noqa: BLE001 - timing is diagnostic-only; never let it fail a valid grade
            pass
    return result
