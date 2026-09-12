"""P2-14: Release gate — CI-friendly conformance check (model-free; no Docker or models).

The model-free gate runs EVERY runnable vector (canonical + Phase B + adversarial) AND the behavioral
control assertions that prove each lever/denial actually fired as intended (not merely that the chain
completed).

Compose-only vectors (network isolation / protocol-level malformations that need the live Docker
estate) are a SEPARATE required gate: listed here and executed under Docker on the VM — never silently
skipped inside this one.
"""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))


def run_gate(*, report_path: str | None = None, verbose: bool = False) -> bool:
    from conformance.runner import run_vector  # noqa: E402
    from conformance.vectors import all_vectors  # noqa: E402
    from conformance.report import generate_report, print_report  # noqa: E402
    from conformance.behavioral import run_behavioral  # noqa: E402

    results, compose_only = [], []
    for v in all_vectors():
        r = run_vector(v)
        if r.get("skipped"):
            compose_only.append(v["name"])
        status = "SKIP" if r.get("skipped") else ("PASS" if r["overall_pass"] else "FAIL")
        if verbose:
            print(f"[{status}] {v['name']}")
        results.append(r)

    if verbose:
        print("\n-- behavioral controls (prove each control actually fired) --")
    behavioral = run_behavioral(verbose=verbose)

    report = generate_report(results, output_path=report_path)
    vectors_ok = report["summary"]["conformant"]
    behavioral_ok = all(b["pass"] for b in behavioral)

    if verbose:
        print()
        print_report(report)
        bp = sum(1 for b in behavioral if b["pass"])
        print(f"Behavioral: {bp}/{len(behavioral)} controls proven")
        if compose_only:
            print(f"\nDeferred to the separate Docker gate ({len(compose_only)}): "
                  f"{', '.join(compose_only)}")

    return vectors_ok and behavioral_ok


if __name__ == "__main__":
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    report_path = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg in ("--report", "-r") and i < len(sys.argv) - 1:
            report_path = sys.argv[i + 1]

    ok = run_gate(report_path=report_path, verbose=verbose)
    sys.exit(0 if ok else 1)
