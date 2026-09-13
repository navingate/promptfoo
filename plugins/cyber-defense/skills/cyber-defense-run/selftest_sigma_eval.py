#!/usr/bin/env python3
"""Stdlib-only selftest for the Sigma-subset matcher (sigma_eval.evaluate). Run: `python3 selftest_sigma_eval.py`."""

import sys

from sigma_eval import SigmaUnsupported, evaluate

PS_ENC = {"process": r"C:\Windows\System32\powershell.exe", "command_line": "powershell -EncodedCommand ZQBjAGgA"}
PS_BENIGN = {"process": r"C:\Windows\System32\powershell.exe", "command_line": "powershell Get-Process"}
ENCODER = {"process": r"C:\tools\encoder.exe", "command_line": "encoder.exe --enc input.txt"}


def check(label, got, exp):
    assert got == exp, f"{label}: expected {exp}, got {got}"
    print(f"  ok: {label}")


def main() -> int:
    print("[selftest_sigma_eval]")

    # The intended "correct" rule: powershell AND an encoded-command flag.
    correct = {"detection": {
        "sel": {"process|endswith": "powershell.exe",
                "command_line|contains": ["-enc", "-ec", "-encodedcommand"]},
        "condition": "sel"}}
    check("correct fires on encoded ps", evaluate(correct, PS_ENC), True)
    check("correct ignores benign ps", evaluate(correct, PS_BENIGN), False)
    check("correct ignores encoder.exe (not powershell)", evaluate(correct, ENCODER), False)

    # A naive over-broad rule (contains 'enc' anywhere) false-positives on encoder.exe.
    naive = {"detection": {"sel": {"command_line|contains": "enc"}, "condition": "sel"}}
    check("naive false-positives encoder.exe", evaluate(naive, ENCODER), True)

    # match-all and match-none behaviours used by the calibration fixtures.
    match_all = {"detection": {"sel": {"process|contains": ""}, "condition": "sel"}}  # '' is substring of all
    check("match-all fires on benign", evaluate(match_all, PS_BENIGN), True)

    # condition grammar
    andnot = {"detection": {
        "sel": {"process|endswith": "powershell.exe"},
        "filter": {"command_line|contains": "get-process"},
        "condition": "sel and not filter"}}
    check("and-not excludes the filtered benign", evaluate(andnot, PS_BENIGN), False)
    check("and-not keeps the encoded ps", evaluate(andnot, PS_ENC), True)

    allof = {"detection": {"a": {"process|endswith": "powershell.exe"},
                           "b": {"command_line|contains": "-encodedcommand"}, "condition": "all of them"}}
    check("all of them needs both", (evaluate(allof, PS_ENC), evaluate(allof, PS_BENIGN)), (True, False))

    oneof = {"detection": {"a": {"command_line|contains": "-enc"},
                           "b": {"command_line|contains": "mimikatz"}, "condition": "1 of them"}}
    check("1 of them fires on either", evaluate(oneof, PS_ENC), True)

    # |all across a value list (must contain BOTH substrings)
    allmod = {"detection": {"sel": {"command_line|contains|all": ["powershell", "-encodedcommand"]}, "condition": "sel"}}
    check("|all needs every substring", (evaluate(allmod, PS_ENC), evaluate(allmod, PS_BENIGN)), (True, False))

    # unsupported constructs must RAISE, not silently pass
    for bad in (
        {"detection": {"sel": {"f|weirdmod": "x"}, "condition": "sel"}},
        {"detection": {"sel": {"f": "x"}, "condition": "sel or other"}},
        {"detection": {"sel": {"f": "x"}, "condition": "count(f) > 5"}},
    ):
        try:
            evaluate(bad, PS_ENC)
        except SigmaUnsupported:
            continue
        raise AssertionError(f"expected SigmaUnsupported for {bad}")
    print("  ok: unsupported constructs raise SigmaUnsupported")

    print("[selftest_sigma_eval] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
