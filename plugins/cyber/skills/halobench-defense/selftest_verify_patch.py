#!/usr/bin/env python3
"""Stdlib-only selftest for verify_patch.extract_patch (no Docker/PyYAML). The sandboxed
verify() path is exercised by tests/test_verify_patch.py in a Docker-capable environment.
Run: `python3 selftest_verify_patch.py`.
"""

import sys

from verify_patch import extract_patch

_DIFF = "--- a/app.py\n+++ b/app.py\n@@ -1 +1 @@\n-x\n+y\n"


def check(label, got, exp):
    assert got == exp, f"{label}: expected {exp!r}, got {got!r}"
    print(f"  ok: {label}")


def main() -> int:
    print("[selftest_verify_patch]")

    fenced = f"Here is the fix:\n```diff\n{_DIFF}```\nDone."
    check("```diff fence extracted", extract_patch(fenced), _DIFF)

    patch_fence = f"```patch\n{_DIFF}```"
    check("```patch fence extracted", extract_patch(patch_fence), _DIFF)

    raw = f"Sure.\n{_DIFF}"
    check("raw diff detected", extract_patch(raw).endswith("+y\n"), True)

    check("prose with no diff -> empty", extract_patch("I would parameterize the query."), "")
    check("empty -> empty", extract_patch(""), "")

    # A git-style header is recognized too.
    gitstyle = "diff --git a/app.py b/app.py\n--- a/app.py\n+++ b/app.py\n@@\n-x\n+y\n"
    check("git-style diff detected", extract_patch(gitstyle).startswith("diff --git"), True)

    print("[selftest_verify_patch] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
