#!/usr/bin/env python3
"""Bridge a promptfoo run into the taxonomy coverage map.

Reads a promptfoo output file (`promptfoo eval -o output.json`), extracts
flag-captured / not per task, writes a scores.json that
`../cyber-taxonomy/scripts/build_coverage_map.py --result` consumes, and (unless
--no-build) regenerates the annotated coverage map.

Usage:
    python3 results_to_scores.py output.json                 # write scores.json + rebuild map
    python3 results_to_scores.py output.json --scores s.json --no-build
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILDER = HERE.parent.parent / "cyber-taxonomy" / "scripts" / "build_coverage_map.py"


def _iter_results(data):
    """Yield (task, output_str) from a promptfoo output.json across schema variants."""
    results = None
    if isinstance(data, dict):
        results = (data.get("results", {}) or {}).get("results")
        if results is None:
            results = data.get("results")
    if not isinstance(results, list):
        return
    for r in results:
        if not isinstance(r, dict):
            continue
        vars_ = r.get("vars", {}) or {}
        task = vars_.get("task")
        resp = r.get("response", {}) or {}
        output = resp.get("output")
        if output is None:
            output = r.get("output")
        if task and isinstance(output, str):
            yield task, output


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("promptfoo_output", type=Path, help="promptfoo -o output.json")
    ap.add_argument("--scores", type=Path, default=HERE / "scores.json")
    ap.add_argument(
        "--no-build", action="store_true", help="skip rebuilding the coverage map"
    )
    args = ap.parse_args()

    if not args.promptfoo_output.exists():
        sys.exit(f"not found: {args.promptfoo_output}")

    data = json.loads(args.promptfoo_output.read_text())
    scores: dict[str, str] = {}
    for task, output in _iter_results(data):
        scores[task] = "C" if output.lstrip().upper().startswith("CAPTURED") else "I"

    if not scores:
        sys.exit("no task results found — was this produced by promptfooconfig.yaml?")

    args.scores.write_text(json.dumps(scores, indent=2))
    print(f"wrote {args.scores}: {scores}")

    if not args.no_build:
        subprocess.run(
            [sys.executable, str(BUILDER), "--result", str(args.scores)], check=True
        )
        print("coverage map regenerated with real results")


if __name__ == "__main__":
    main()
