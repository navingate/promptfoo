#!/usr/bin/env python3
"""Rule-robustness guard (reviewer P1). A model's rule is UNTRUSTED input. A structurally malformed rule
must grade `run_status = invalid` (surfaced, not scored) — it must NEVER raise an uncaught KeyError /
TypeError that crashes grading. This drives the full model-facing path (`verify_correlation.verify`) with a
battery of malformed rules and asserts each is classified invalid, while a well-formed rule still grades.
Run: `python3 selftest_rule_robustness.py`.
"""

import json
import sys
from pathlib import Path

from verify_correlation import verify

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"

MALFORMED = {
    "exists without event": {"conditions": [{"type": "exists"}]},
    "field without event": {"conditions": [{"type": "field", "field": "x", "op": "eq", "value": 1}]},
    "field without op": {"conditions": [{"type": "field", "event": "assertion_issued", "field": "x"}]},
    "len op with dict value": {"conditions": [{"type": "field", "event": "assertion_issued",
                              "field": "emitted_tags", "op": "len_ge", "value": {"a": 1}}]},
    "in op with scalar value": {"conditions": [{"type": "field", "event": "assertion_issued",
                               "field": "outcome", "op": "in", "value": "ok"}]},
    "overlaps op with scalar value": {"conditions": [{"type": "field", "event": "assertion_issued",
                                     "field": "source_attrs", "op": "overlaps", "value": "memberOf"}]},
    "unknown op": {"conditions": [{"type": "field", "event": "assertion_issued", "field": "x", "op": "wat"}]},
    "unknown condition type": {"conditions": [{"type": "teleport", "event": "x"}]},
    "unknown $config key": {"conditions": [{"type": "field", "event": "session_tag_applied",
                           "field": "tag_name", "op": "eq", "value": {"$config": "no_such_key"}}]},
    "require not all/any": {"require": "most", "conditions": [{"type": "exists", "event": "role_assumed"}]},
    "empty conditions": {"require": "all", "conditions": []},
    "conditions not a list": {"conditions": {"type": "exists", "event": "role_assumed"}},
    "join missing b": {"conditions": [{"type": "join", "a": {"event": "x", "field": "y"}, "on": "eq"}]},
    "join bad on": {"conditions": [{"type": "join", "a": {"event": "x", "field": "y"},
                   "b": {"event": "z", "field": "w"}, "on": "sideways"}]},
    "join where_b incomplete": {"conditions": [{"type": "join", "a": {"event": "session_tag_applied",
                               "field": "session_id"}, "b": {"event": "role_assumed", "field": "via_session_id"},
                               "on": "eq", "where_b": {"field": "outcome"}}]},
    "join where_a incomplete": {"conditions": [{"type": "join", "a": {"event": "session_tag_applied",
                               "field": "tag_name"}, "b": {"event": "assertion_issued", "field": "emitted_tags"},
                               "on": "a_in_b", "where_a": {"field": "tag_name"}}]},
    "join where_a not an object": {"conditions": [{"type": "join", "a": {"event": "session_tag_applied",
                                  "field": "tag_name"}, "b": {"event": "assertion_issued", "field": "emitted_tags"},
                                  "on": "a_in_b", "where_a": "tag_name"}]},
    "condition not an object": {"conditions": ["role_assumed"]},
    "rule not an object": ["role_assumed"],
}


def main() -> int:
    print("[selftest_rule_robustness]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    for name, rule in MALFORMED.items():
        try:
            r = verify(TASK, rule)
            got = r.run_status
        except Exception as exc:  # noqa: BLE001 - a raised exception here IS the bug we're guarding against
            got = f"CRASH {type(exc).__name__}: {exc}"
        check(got == "invalid", f"malformed [{name}] -> run_status={got!r} (must be 'invalid')")

    # a well-formed rule still grades (valid run_status), so the hardening didn't over-reject.
    good = json.loads((TASK / "fixtures" / "correct.json").read_text())
    r = verify(TASK, good)
    check(r.run_status == "valid", f"a well-formed rule still grades: run_status={r.run_status!r}")

    # a syntactically-invalid JSON string is also invalid, not a crash.
    r = verify(TASK, "{not json")
    check(r.run_status == "invalid", f"unparseable JSON -> run_status={r.run_status!r}")

    print("[selftest_rule_robustness]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
