"""P2-14: Release gate — CI-friendly conformance check.

Exits 0 if all canonical vectors pass, non-zero otherwise.
Runs the full vector suite without Docker or models.
"""
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))


def run_gate(*, report_path: str | None = None, verbose: bool = False) -> bool:
    from conformance.runner import run_vector  # noqa: E402
    from conformance.vectors import CANONICAL_VECTORS  # noqa: E402
    from conformance.report import generate_report, print_report  # noqa: E402

    results = []
    for v in CANONICAL_VECTORS:
        r = run_vector(v)
        status = "PASS" if r["overall_pass"] else "FAIL"
        if verbose:
            print(f"[{status}] {v['name']}")
        results.append(r)

    report = generate_report(results, output_path=report_path)
    if verbose:
        print()
        print_report(report)

    return report["summary"]["conformant"]


if __name__ == "__main__":
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    report_path = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg in ("--report", "-r") and i < len(sys.argv) - 1:
            report_path = sys.argv[i + 1]

    ok = run_gate(report_path=report_path, verbose=verbose)
    sys.exit(0 if ok else 1)
