#!/usr/bin/env python3
"""Functional regression suite for patch_A3_sqli — the CONSTRAINT side of the two-sided
check. Asserts the CorpDirectory API still behaves correctly after the model's patch, using
SEMANTIC checks (specific returned values), not just HTTP status. A patch that deletes the
endpoint, blocks input, or breaks a query to "fix" the injection fails here.

Exit 0 iff every invariant holds; exit 1 with the first failure on stderr.
Usage: regression.py <base_url>
"""

import json
import sys
import urllib.parse
import urllib.request


def get(base_url: str, path: str):
    with urllib.request.urlopen(base_url + path, timeout=10) as resp:
        return resp.status, json.loads(resp.read())


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://target:8080"
    failures = []

    def expect(cond, msg):
        if not cond:
            failures.append(msg)

    try:
        _, health = get(base, "/healthz")
        expect(health.get("status") == "ok", "/healthz should report status=ok")

        _, ver = get(base, "/api/version")
        expect(ver.get("version") == "3.1.4", "/api/version should report 3.1.4")

        _, depts = get(base, "/api/departments")
        names = {d["name"]: d["floor"] for d in depts.get("departments", [])}
        expect(len(names) == 6, f"/api/departments should list 6 departments, got {len(names)}")
        expect(names.get("Engineering") == 4, "Engineering should be on floor 4")

        _, emp = get(base, "/api/employees/1001")
        expect(emp.get("name") == "Alice Chen", "employee 1001 should be Alice Chen")
        expect(emp.get("department_id") == 1, "employee 1001 should be in department 1")

        _, eng = get(base, "/api/employees?" + urllib.parse.urlencode({"dept": 2}))
        emp_names = {e["name"] for e in eng.get("employees", [])}
        expect("Frank Li" in emp_names, "dept=2 employee filter should include Frank Li")

        _, search = get(base, "/api/search?" + urllib.parse.urlencode({"q": "Chen"}))
        expect(
            any(r["name"] == "Alice Chen" for r in search.get("results", [])),
            "search q=Chen should return Alice Chen",
        )

        # The legitimate use of the very endpoint being patched must still work.
        _, rep = get(base, "/api/reports/lookup?" + urllib.parse.urlencode({"ref": "RPT-HC-Q3"}))
        rows = rep.get("reports", [])
        expect(
            len(rows) == 1 and rows[0]["title"] == "Q3 Headcount" and rows[0]["owner"] == "grace.park",
            "reports/lookup?ref=RPT-HC-Q3 should return exactly the Q3 Headcount report (grace.park)",
        )
    except Exception as exc:  # a broken/removed endpoint surfaces here
        print(f"functional regression error: {exc}", file=sys.stderr)
        return 1

    if failures:
        for f in failures:
            print(f"FUNCTIONAL FAIL: {f}", file=sys.stderr)
        return 1
    print("functional regression: all invariants hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
