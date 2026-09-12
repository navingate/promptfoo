"""P2-13: Conformance report generator.

Produces a structured conformance report from runner results.
"""
import json
import time
from .contract import CONTRACT_VERSION, INVARIANTS, DIFFICULTY_LEVERS, CALIBRATION_LADDER


def generate_report(results: list[dict], *, output_path: str | None = None) -> dict:
    """Generate a conformance report from a list of vector results."""
    total = len(results)
    passed = sum(1 for r in results if r["overall_pass"])
    failed = [r for r in results if not r["overall_pass"]]

    schema_errors = []
    for r in results:
        sv = r.get("schema_validation", {})
        if not sv.get("valid", True):
            schema_errors.extend(
                {"vector": r["vector"], "error": e}
                for e in sv.get("errors", [])
            )

    oracle_failures = []
    for r in results:
        for c in r.get("oracle_checks", []):
            if not c["pass"]:
                oracle_failures.append({"vector": r["vector"], "check": c["check"]})

    event_stats = {}
    for r in results:
        sv = r.get("schema_validation", {})
        for et, count in sv.get("stats", {}).get("by_type", {}).items():
            event_stats[et] = event_stats.get(et, 0) + count

    report = {
        "title": "F2 Layer 2 Conformance Report",
        "contract_version": CONTRACT_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {
            "total_vectors": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": f"{passed}/{total}",
            "conformant": passed == total,
        },
        "failed_vectors": [
            {
                "name": r["vector"],
                "chain_completed": r["chain_completed"],
                "expected": r["expected_completion"],
                "schema_valid": r.get("schema_validation", {}).get("valid"),
                "oracle_pass": r.get("oracle_pass"),
            }
            for r in failed
        ],
        "schema_errors": schema_errors[:50],
        "oracle_failures": oracle_failures,
        "telemetry_stats": {
            "total_events": sum(event_stats.values()),
            "by_type": event_stats,
        },
        "invariants": INVARIANTS,
        "difficulty_levers": DIFFICULTY_LEVERS,
        "calibration_ladder": CALIBRATION_LADDER,
    }

    if output_path:
        with open(output_path, "w") as f:
            json.dump(report, f, indent=2)

    return report


def print_report(report: dict):
    """Print a human-readable conformance report."""
    s = report["summary"]
    print(f"=== {report['title']} ===")
    print(f"Contract: v{report['contract_version']}")
    print(f"Generated: {report['generated_at']}")
    print(f"\nResult: {'CONFORMANT' if s['conformant'] else 'NON-CONFORMANT'}")
    print(f"Vectors: {s['pass_rate']} passed")

    if report["failed_vectors"]:
        print(f"\nFailed vectors:")
        for fv in report["failed_vectors"]:
            print(f"  - {fv['name']}: chain={fv['chain_completed']}, "
                  f"expected={fv['expected']}, schema={fv['schema_valid']}, "
                  f"oracle={fv['oracle_pass']}")

    if report["schema_errors"]:
        print(f"\nSchema errors ({len(report['schema_errors'])}):")
        for se in report["schema_errors"][:10]:
            print(f"  [{se['vector']}] {se['error']}")

    if report["oracle_failures"]:
        print(f"\nOracle failures ({len(report['oracle_failures'])}):")
        for of in report["oracle_failures"]:
            print(f"  [{of['vector']}] {of['check']}")

    ts = report["telemetry_stats"]
    print(f"\nTelemetry: {ts['total_events']} events across {len(ts['by_type'])} types")
