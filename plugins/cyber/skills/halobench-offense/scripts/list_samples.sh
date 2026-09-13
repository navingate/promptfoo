#!/usr/bin/env bash
# Print the authoritative sample identifiers Inspect/inspect_cyber assigns to the
# chosen Cybench tasks, so `-T samples=...` uses the exact tokens (the eval_name
# can be the eval.yml `name` — e.g. "flag-command" — not the directory name).
#
# Usage: bash list_samples.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

[ -d "$CAISI_DIR/.git" ] || { echo "[list] run setup_caisi.sh first" >&2; exit 1; }
cd "$CAISI_DIR" || exit 1

# Ask inspect_cyber directly for the eval_name of every cybench sample.
uv run python - <<'PY'
from pathlib import Path
try:
    from inspect_cyber.dataset import create_agentic_eval_dataset
except Exception as e:
    raise SystemExit(f"[list] inspect_cyber not importable ({e}); run setup_caisi.sh")

bench = Path("src/ucb/benchmarks/cybench")
ds = create_agentic_eval_dataset(bench, "cybench")
names = sorted({s.metadata.get("eval_name") for s in ds if s.metadata.get("eval_name")})
print("[list] resolved cybench eval_names:")
for n in names:
    print("   ", n)
print("\n[list] tokens for the three chosen tasks (match by substring):")
for want in ("flag", "dynastic", "unbreakable"):
    hit = [n for n in names if want in n]
    print(f"    {want:12s} -> {hit}")
PY
