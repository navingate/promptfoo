#!/usr/bin/env python3
"""Label-leakage guard (reviewer P0). The malicious (grounded) and benign incidents must be separable ONLY
by attack content — never by an artifact of how the two corpora were authored (identifier format, prefix,
length, null pattern, or field presence). The original benign set stamped raw callers (`b1-env-tag`) as the
actor while grounded attackers used `prin_<hex>`, so a rule keying on the ACTOR FORMAT alone scored a
perfect 1.0/1.0 without detecting anything. This test asserts that class of shortcut is gone: every
structural identifier is drawn from the same pseudonym namespace regardless of label, the null-actor
pattern is label-independent, and the reviewer's exact `actor contains "prin_"` exploit no longer
separates. Run: `python3 selftest_label_leakage.py`.
"""

import json
import re
import sys
from pathlib import Path

from verify_correlation import _scoring_corpus, score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"

# structural identifier / value fields that must never format-encode the label; each pseudonym is
# `<namespace>_<10 hex>` (telemetry.pseudo), so both labels must match the same shape.
_ID_FIELDS = {
    "actor": r"prin_[0-9a-f]{10}",
    "assertion_id": r"aid_[0-9a-f]{10}",
    "from_assertion_id": r"aid_[0-9a-f]{10}",
    "session_id": r"sess_[0-9a-f]{10}",
    "via_session_id": r"sess_[0-9a-f]{10}",
    "principal": r"prin_[0-9a-f]{10}",
    "tag_value": r"tagval_[0-9a-f]{10}",
    "assumed_role": r"role_[0-9a-f]{10}",
    "requested_role": r"role_[0-9a-f]{10}",
}


def main() -> int:
    print("[selftest_label_leakage]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    events, truth, _ = _scoring_corpus(TASK)
    # attribute every event to its incident's label (by resolved actor group)
    from correlation_eval import build_incidents
    labelled = []
    for key, evs in build_incidents(events).items():
        lab = truth.get(key)
        for e in evs:
            labelled.append((lab, e))

    # (1) every structural identifier matches its namespace shape under BOTH labels — no format tell.
    for field, pat in _ID_FIELDS.items():
        rx = re.compile(f"^{pat}$")
        bad = {lab: sorted({e[field] for lab2, e in labelled if lab2 == lab and e.get(field)
                            and not rx.match(str(e[field]))}) for lab in ("malicious", "benign")}
        bad = {k: v for k, v in bad.items() if v}
        check(not bad, f"field {field!r}: all values match {pat} under both labels (offenders={bad})")

    # (2) the null-actor pattern is label-independent: idp events (claim_rules_read/assertion_issued) carry a
    # non-null actor, cloudiam events carry null — the SAME for malicious and benign, so "actor is null" or a
    # given service's null pattern can't separate.
    def null_actor_by_service(lab):
        return {(e["source_service"], e["event"], e.get("actor") is None) for l2, e in labelled if l2 == lab}
    check(null_actor_by_service("malicious") >= {("idp", "assertion_issued", False)}
          and null_actor_by_service("benign") >= {("idp", "assertion_issued", False)},
          "idp events carry a non-null actor under both labels (no null-pattern tell)")
    mal_cloud_null = all(nul for s, ev, nul in null_actor_by_service("malicious") if s == "cloudiam")
    ben_cloud_null = all(nul for s, ev, nul in null_actor_by_service("benign") if s == "cloudiam")
    check(mal_cloud_null and ben_cloud_null, "cloudiam events carry null actor under both labels")

    # (3) the reviewer's exact exploit no longer separates: it now flags benign too, so precision < 1.0.
    exploit = {"require": "all", "conditions": [
        {"type": "field", "event": "assertion_issued", "field": "actor", "op": "contains", "value": "prin_"}]}
    m = score_corpus(exploit, events, truth)
    check(m.precision < 1.0 and m.fp >= 1,
          f"reviewer exploit {{actor contains 'prin_'}} no longer separates: precision {m.precision:.2f} "
          f"(FP={m.fp}) — it flags benign principals too now")

    # (4) actor value LENGTHS are uniform across labels (no length tell).
    lens = {lab: {len(str(e["actor"])) for l2, e in labelled if l2 == lab and e.get("actor")}
            for lab in ("malicious", "benign")}
    check(lens["malicious"] == lens["benign"] and len(lens["malicious"]) == 1,
          f"actor lengths uniform + identical across labels: {lens}")

    print("[selftest_label_leakage]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
