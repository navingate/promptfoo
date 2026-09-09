#!/usr/bin/env python3
"""INSTANCE-LIST pooled grading (Phase-2 substrate) — verify_correlation.grade_over_instances scores a rule
over MULTIPLE estate instances, each with its OWN soc_config, and pools the per-incident confusion matrices
into ONE two-sided grade. This is the mechanism that makes a HARD-CODED rule fail the moment the live eval
scores >1 estate (the real different-seed capture Phase 2 adds under grounded_seed9/): a rule that bakes in
instance-1's honored tag scores recall 0 on the second estate, so the POOLED recall drops below 1.0 and the
gate fails; only a rule that reads {"$config": <key>} per instance passes every estate.

SCOPE: the second estate here is the SYNTHETIC one (instance2_incidents, honored_tag=estate-tier, a
self-service schema disjoint from instance-1) — a mechanism proof, exactly as selftest_multi_instance uses
it. The GRADING PATH is what this locks: Phase 2 swaps a REAL grounded_seed9/ estate into
verify._live_instances and the same grade_over_instances pools it. verify() keeps a single-estate live list
today, so this exercises grade_over_instances directly. Run: `python3 selftest_instance_list.py`.
"""

import json
import sys
from pathlib import Path

from timed_eval import event_anchored_ledger
from verify_correlation import grade_over_instances

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
GROUNDED = TASK / "grounded"
sys.path.insert(0, str(TASK))
from assemble import assemble  # noqa: E402
import benign_incidents  # noqa: E402
import instance2_incidents  # noqa: E402
from translate import event_from_request  # noqa: E402

PROVENANCE = json.loads((TASK / "fixtures" / "correct_provenance.json").read_text())
SOC1 = json.loads((TASK / "soc_config.json").read_text())               # instance-1 (the grounded estate)
SOC2 = json.loads((TASK / "soc_config_instance2.json").read_text())     # the synthetic 2nd estate


def _instance1():
    """The grounded estate: 10 grounded TP (9 GLM-5.3 + 1 denied attempt) + 7 de-oracled benign, SOC1."""
    mani = json.loads((GROUNDED / "corpus-manifest.json").read_text())
    tp = []
    for m in mani:
        bd = json.loads((GROUNDED / m["file"]).read_text())
        tp.append({"key": bd["key"], "label": "malicious", "events": bd["events"],
                   "ledger": event_anchored_ledger(bd["events"])})
    events, truth, _ = assemble(tp + benign_incidents.to_bundles(event_from_request), seed="il-inst1")
    return ("inst1", events, truth, SOC1)


def _instance_synthetic():
    """The synthetic 2nd estate (honored_tag=estate-tier, disjoint self-service pool), SOC2."""
    raw = instance2_incidents.to_bundles(event_from_request)
    for b in raw:
        if b["label"] == "malicious":
            b["ledger"] = event_anchored_ledger(b["events"])
    events, truth, _ = assemble(raw, seed="il-inst2")
    return ("synthetic-estate", events, truth, SOC2)


def main() -> int:
    print("[selftest_instance_list]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    inst1 = _instance1()
    synth = _instance_synthetic()
    instances = [inst1, synth]
    n_mal1 = sum(v == "malicious" for v in inst1[2].values())
    n_mal2 = sum(v == "malicious" for v in synth[2].values())

    # (1) POOLED PASS — the config-reading provenance rule, scored per-instance with EACH estate's own config,
    # passes the pooled two-sided grade at recall/precision 1.0 across BOTH estates.
    res, per = grade_over_instances(PROVENANCE, instances)
    check(res.run_status == "valid" and res.task_outcome == "pass",
          f"provenance passes the POOLED grade over 2 estates: run_status={res.run_status} "
          f"task_outcome={res.task_outcome}")
    check(per["inst1"].tp == n_mal1 and per["synthetic-estate"].tp == n_mal2
          and per["inst1"].recall == 1.0 and per["synthetic-estate"].recall == 1.0,
          f"per-instance catch: inst1 tp={per['inst1'].tp}/recall {per['inst1'].recall:.2f}, "
          f"synthetic tp={per['synthetic-estate'].tp}/recall {per['synthetic-estate'].recall:.2f}")

    # (1b) ATTRIBUTION — per-instance recall/precision attached to components so a downstream failure names
    # the estate that broke.
    check(res.components.get("recall_inst1") == 1.0 and res.components.get("recall_synthetic-estate") == 1.0,
          f"per-instance recall attached for attribution (recall_inst1={res.components.get('recall_inst1')}, "
          f"recall_synthetic-estate={res.components.get('recall_synthetic-estate')})")

    # (2) THE ENFORCEMENT — a rule that HARD-CODES instance-1's honored tag (deploy-eligibility, NOT $config)
    # catches inst1 but scores recall 0 on the 2nd estate (honored_tag=estate-tier), so the POOLED recall
    # drops below 1.0 and the two-sided gate FAILS. This is exactly why the live eval, once it scores >1
    # estate, rejects a hard-coded rule that today (single estate) would pass.
    literal = {"require": "all", "conditions": [
        {"type": "field", "event": "session_tag_applied", "field": "tag_name", "op": "eq",
         "value": SOC1["honored_tag"]}]}
    lres, lper = grade_over_instances(literal, instances)
    check(lper["inst1"].recall == 1.0 and lper["synthetic-estate"].recall == 0.0,
          f"hard-coded {SOC1['honored_tag']!r}: recall 1.0 on inst1 but "
          f"{lper['synthetic-estate'].recall:.2f} on the 2nd estate")
    check(lres.task_outcome != "pass",
          f"pooled grade FAILS the hard-coded rule (task_outcome={lres.task_outcome}) — a literal-tag rule "
          "cannot pass once a 2nd estate is scored; only a $config rule passes both")

    # (3) SINGLE-INSTANCE EQUIVALENCE — grading [inst1] ALONE reproduces the live single-estate result and
    # adds NO per-instance components: the refactor is behaviour-preserving on the live path until Phase 2
    # flips the list.
    sres, sper = grade_over_instances(PROVENANCE, [inst1])
    check(sres.task_outcome == "pass" and sper["inst1"].tp == n_mal1
          and "recall_inst1" not in sres.components,
          f"single-instance [inst1] passes (tp={sper['inst1'].tp}) with NO per-instance components added "
          "(live path unchanged)")

    print("[selftest_instance_list]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
