#!/usr/bin/env python3
"""ESTATE-PORTABILITY / instance-independence -- the config-driven provenance rule generalizes to a DIFFERENT
estate via config alone, reading BOTH keys it depends on.

selftest_preventive check #4 varies only the honored tag NAME (keeping instance-1's smuggle attr), so a rule
that hard-codes instance-1's self_service_attrs POOL as a literal would still pass it. This closes that gap:
instance-2 is a different ESTATE -- a different honored_tag AND a self-service IdP schema DISJOINT from
instance-1's pool (smuggle via costCenter/orgUnit, not in instance-1's _SOURCE_ATTRS). The SAME
fixtures/correct_provenance.json scores it 1.0/1.0 with instance-2's SOC config; a rule literal in EITHER key
fails; and the mapping is SYMMETRIC (instance-1 config fails on instance-2 AND instance-2 config fails on
instance-1) -- so it is config, not coincidence.

SCOPE: a SYNTHETIC mechanism proof, scored as its OWN corpus, deliberately separate from the grounded 9-TP
scoring corpus -- it never joins the live eval (that would be a future gate-promotion step). Real
different-estate captures are the ecological-validity follow-on. Run: `python3 selftest_multi_instance.py`.
"""

import json
import sys
from pathlib import Path

from timed_eval import event_anchored_ledger
from verify_correlation import score_corpus

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
SOC2 = json.loads((TASK / "soc_config_instance2.json").read_text())     # instance-2 (a different estate)


def build_instance1():
    """The grounded estate: 9 real TP + 7 de-oracled benign (same as the live scoring corpus)."""
    mani = json.loads((GROUNDED / "corpus-manifest.json").read_text())
    tp = []
    for m in mani:
        bd = json.loads((GROUNDED / m["file"]).read_text())
        tp.append({"key": bd["key"], "label": "malicious", "events": bd["events"],
                   "ledger": event_anchored_ledger(bd["events"])})
    return assemble(tp + benign_incidents.to_bundles(event_from_request), seed="multi-inst1")


def build_instance2():
    """The synthetic second estate: its own malicious + benign, shaped through the shared shaper."""
    raw = instance2_incidents.to_bundles(event_from_request)
    for b in raw:
        if b["label"] == "malicious":
            b["ledger"] = event_anchored_ledger(b["events"])
    return assemble(raw, seed="multi-inst2")


def main() -> int:
    print("[selftest_multi_instance]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    ev1, truth1, _ = build_instance1()
    ev2, truth2, _ = build_instance2()
    n_mal = sum(v == "malicious" for v in truth2.values())
    n_ben = sum(v == "benign" for v in truth2.values())
    check(n_mal >= 2 and n_ben >= 3,
          f"instance-2 is its OWN synthetic corpus: {n_mal} malicious + {n_ben} benign (ungrounded, "
          "separate from the 9-TP grounded set)")

    # PRECONDITION -- the test is only meaningful if instance-2 smuggles through attrs OUTSIDE instance-1's
    # pool (else a literal instance-1 pool would still match and we would prove nothing beyond #4).
    smuggle = set(instance2_incidents.SMUGGLE_SRCS)
    check(smuggle.isdisjoint(SOC1["self_service_attrs"]),
          f"instance-2 smuggle attrs {sorted(smuggle)} are DISJOINT from instance-1's self-service pool")
    check(smuggle <= set(SOC2["self_service_attrs"]) and SOC2["honored_tag"] != SOC1["honored_tag"],
          f"instance-2 SOC config declares the new honored_tag {SOC2['honored_tag']!r} + a pool containing "
          "the smuggle attrs")

    # (1) BASELINE -- the reference rule + instance-1 config scores the grounded estate 1.0/1.0 (harness sanity).
    b = score_corpus(PROVENANCE, ev1, truth1, config=SOC1)
    check(b.recall == 1.0 and b.precision == 1.0 and b.tp == 9,
          f"baseline: provenance + instance-1 config -> recall {b.recall:.2f}/precision {b.precision:.2f} (TP={b.tp})")

    # (2) PORTABILITY -- the SAME rule scores a DIFFERENT estate 1.0/1.0 with instance-2's config alone (no
    # rule change). Precision 1.0 means the instance-2 legit-escalation twin (memberOf -> estate-tier) is spared.
    m = score_corpus(PROVENANCE, ev2, truth2, config=SOC2)
    check(m.recall == 1.0 and m.precision == 1.0,
          f"portable: same provenance rule + instance-2 config -> recall {m.recall:.2f}/precision "
          f"{m.precision:.2f} (honored_tag={SOC2['honored_tag']!r}); the legit twin is spared")

    # (3) THE NEW CLAIM beyond selftest_preventive #4 -- `self_service_attrs` is genuinely CONFIG-READ, not a
    # baked-in literal. Give the rule the CORRECT honored_tag but instance-1's POOL: it now MISSES instance-2's
    # smuggle, because the out-of-pool source attr does not overlap that literal pool (where_b empty).
    wrong_pool = {**SOC2, "self_service_attrs": SOC1["self_service_attrs"]}
    mp = score_corpus(PROVENANCE, ev2, truth2, config=wrong_pool)
    check(mp.recall < 1.0,
          f"self_service_attrs is config-read: correct tag + instance-1's POOL -> recall {mp.recall:.2f} on "
          "instance-2 (misses the out-of-pool smuggle) -- exactly what check #4 does not test")

    # (4) SYMMETRY -- each estate's WHOLE config fails on the OTHER estate, so the 1.0/1.0 in (1)/(2) is the
    # config matching the estate, not a rule that happens to fire on anything.
    m1on2 = score_corpus(PROVENANCE, ev2, truth2, config=SOC1)
    check(m1on2.recall < 1.0,
          f"instance-1 config on instance-2 -> recall {m1on2.recall:.2f} (wrong tag + wrong pool -> misses)")
    m2on1 = score_corpus(PROVENANCE, ev1, truth1, config=SOC2)
    check(m2on1.recall < 1.0,
          f"instance-2 config on instance-1 -> recall {m2on1.recall:.2f} (estate-tier finds nothing in the "
          "grounded estate)")

    print("[selftest_multi_instance]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
