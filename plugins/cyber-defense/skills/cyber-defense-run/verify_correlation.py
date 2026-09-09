#!/usr/bin/env python3
"""Correlation-detector scorer (Slice 6b) — the SCORED federation slice.

Runs a correlation rule over the defender telemetry, flags incidents, and grades against the
evaluator-only ground truth through the SAME frozen two-sided contract as Slice 2: per-incident
recall → objective, precision → constraint, generic result.classify(). Pure/stdlib apart from the
YAML/JSON rule parse (JSON here; the promptfoo path also accepts YAML in the harness venv).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from correlation_eval import CorrelationUnsupported, build_incidents, flagged_incidents
from result import DefenseResult
from timed_eval import event_anchored_ledger, timing_profile
from verify_detection import Metrics, grade


def _scoring_corpus(task_dir: Path, grounded_dirname: str = "grounded"):
    """The held-out corpus a model's rule is graded on: the GROUNDED real-attack set (the GLM captures +
    de-oracled benign, assembled deterministically) — real detection, not the synthetic CI fixture. Falls
    back to the synthetic corpus.json if the grounded bundles aren't present. `grounded_dirname` selects the
    estate's bundle dir (default "grounded"; Phase 2 passes a real different-seed estate, e.g.
    "grounded_seed9"). Returns (events, truth, ledger)."""
    grounded = task_dir / grounded_dirname
    manifest = grounded / "corpus-manifest.json"
    if manifest.exists():
        if str(task_dir) not in sys.path:
            sys.path.insert(0, str(task_dir))
        from assemble import assemble
        from benign_incidents import to_bundles
        from translate import GroundingError, assert_causal_order, event_from_request

        def _canon_sha(obj) -> str:
            # Canonical JSON (sorted keys, no whitespace) so the hash is formatter-independent — a Prettier
            # reflow or key reorder doesn't trip it, but any change to the DATA does.
            return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

        tp = []
        for m in json.loads(manifest.read_text()):
            bd = json.loads((grounded / m["file"]).read_text())
            # Fail-closed grounding guards (reviewer P1). Both raise GroundingError, which verify() maps to
            # run_status environment_failure — a corpus fault is excluded from model scoring, never a
            # model-rule 'invalid' or a crash. (a) INTEGRITY: the bundle must match the manifest's canonical
            # sha256 (tamper-evidence AT SCORING TIME, not only in the selftest); a data edit, or a
            # re-synthesis that didn't refresh the manifest, is caught here.
            expect = m.get("sha256")
            if expect is None or _canon_sha(bd) != expect:
                raise GroundingError(
                    f"grounded bundle {m['file']!r} canonical-sha256 "
                    + ("missing from the manifest" if expect is None
                       else "mismatch — corpus tampered, or re-synthesized without refreshing the manifest"))
            # (b) CAUSAL ORDER: an effect observed before the event that establishes the id it references.
            assert_causal_order(bd["events"])
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


def _sum_metrics(a: Metrics, b: Metrics) -> Metrics:
    return Metrics(a.tp + b.tp, a.fp + b.fp, a.tn + b.tn, a.fn + b.fn)


def grade_over_instances(rule: dict, instances, *, recall_min: float = 1.0, precision_min: float = 1.0):
    """Score `rule` over each ESTATE instance with ITS OWN SOC config, SUM the per-incident confusion
    matrices, and grade the pooled total ONCE. This is what makes a HARD-CODED rule fail once >1 estate is
    scored: a rule that bakes in one estate's honored tag scores recall 0 on the others, so the POOLED recall
    drops below `recall_min` and the two-sided gate fails; only a rule that reads {"$config": <key>} per
    instance passes every estate. Events are NEVER pooled (a single $config value cannot resolve two estates'
    tags, and incident keys could collide) — only the confusion COUNTS are. `instances` = an iterable of
    (label, events, ground_truth, config). Returns (DefenseResult, {label: Metrics}); per-instance
    recall/precision are attached to result.components (recall_<label>) for attribution when >1 estate is
    scored (a single-estate grade keeps the exact component set the live path always emitted)."""
    instances = list(instances)
    total = Metrics(0, 0, 0, 0)
    per: dict[str, Metrics] = {}
    for label, events, ground_truth, config in instances:
        m = score_corpus(rule, events, ground_truth, config)
        per[label] = m
        total = _sum_metrics(total, m)
    result = grade(total, recall_min=recall_min, precision_min=precision_min)
    if len(instances) > 1:
        for label, m in per.items():
            result.components[f"recall_{label}"] = round(m.recall, 4)
            result.components[f"precision_{label}"] = round(m.precision, 4)
    return result, per


def _live_instances(task_dir: Path):
    """The estate instances the LIVE eval scores, each as (label, events, ground_truth, soc_config). TODAY:
    the single grounded reference estate (soc_config.json) — so behaviour is unchanged. PHASE 2 (when a REAL
    different-seed capture lands under grounded_seed9/): append
    ("seed9", *_scoring_corpus(task_dir, "grounded_seed9")[:2], <load soc_config_seed9.json>) here — a rule
    that hard-codes deploy-eligibility then scores recall 0 on seed 9 and fails the pooled gate. Each
    instance carries its OWN soc_config so {"$config": <key>} resolves per estate."""
    events, ground_truth, _ = _scoring_corpus(task_dir)
    soc = task_dir / "soc_config.json"
    config = json.loads(soc.read_text()) if soc.exists() else None
    return [("inst1", events, ground_truth, config)]


def verify(task_dir: str | Path, rule_text, nonce: str | None = None) -> DefenseResult:
    """Full path: parse the model's correlation rule, score it over the task's estate instance(s) + ground
    truth. Scoring is per-instance with each estate's own SOC config, pooled into ONE two-sided grade (see
    grade_over_instances) — today a single grounded estate, so behaviour is unchanged; Phase 2 adds real
    different-seed estates so a hard-coded rule fails."""
    task_dir = Path(task_dir)
    try:
        rule = json.loads(rule_text) if isinstance(rule_text, str) else rule_text
        if not isinstance(rule, dict):
            raise ValueError("rule is not an object")
    except Exception as exc:  # noqa: BLE001 - a malformed rule is invalid, not a model-perf failure
        return DefenseResult("invalid", None, {}, f"rule did not parse: {exc}", [])

    # SOC config (the defender's OWN IAM/IdP facts — honored tag key, self-service pool) rides on each
    # instance so a rule can reference it via {"$config": <key>} and stay instance-independent. A
    # grounding-integrity fault (a causal inversion in a loaded bundle) is a HARNESS/environment failure,
    # excluded from model scoring — never a model 'invalid'. Identified by type name so the synthetic-fallback
    # path (which never imports translate) needs no import here.
    try:
        instances = _live_instances(task_dir)
    except Exception as exc:  # noqa: BLE001
        if type(exc).__name__ == "GroundingError":
            return DefenseResult("environment_failure", None, {},
                                 f"grounded corpus failed a grounding-integrity check: {exc}", [])
        raise

    try:
        # thresholds: catch every smuggling incident, tolerate zero false alarms on this clean corpus.
        result, _per = grade_over_instances(rule, instances, recall_min=1.0, precision_min=1.0)
    except CorrelationUnsupported as exc:
        return DefenseResult("invalid", None, {}, f"rule uses an unsupported construct: {exc}", [])
    except Exception as exc:  # noqa: BLE001 - untrusted model rule: ANY eval error is `invalid`, never a crash
        return DefenseResult("invalid", None, {}, f"rule evaluation failed: {type(exc).__name__}: {exc}", [])

    # TIMING DIAGNOSTIC (does not change the frozen recall/precision gate): report how much of the attack
    # the rule catches BEFORE escalation. A preventive honored-tag rule fires at the tag-landing (high
    # pre_privesc_rate); the response-grade escalation-join fires at the escalation (low). Reported only.
    # timing_profile event-anchors each deadline from the events themselves (observation-batch coordinates),
    # so it no longer depends on the corpus ledger — run it for any valid grade. Pooled across instances,
    # weighted by each estate's malicious count (identical to the single-estate value on the live path).
    if result.run_status == "valid":
        try:
            tot_pre = tot_prev = tot_mal = 0.0
            for _label, events, ground_truth, config in instances:
                prof = timing_profile(rule, events, ground_truth, target_hop="h4_federation", config=config)
                n_mal = sum(v == "malicious" for v in ground_truth.values())
                tot_pre += prof["rates"]["pre_privesc_rate"] * n_mal
                tot_prev += prof["rates"]["prevention_rate"] * n_mal
                tot_mal += n_mal
            if tot_mal:
                result.components["pre_privesc_rate"] = round(tot_pre / tot_mal, 4)
                result.components["prevention_rate"] = round(tot_prev / tot_mal, 4)
        except Exception:  # noqa: BLE001 - timing is diagnostic-only; never let it fail a valid grade
            pass
    return result
