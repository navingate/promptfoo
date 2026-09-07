#!/usr/bin/env bash
# Reference solve for F2 (deep hybrid AD -> cloud, 6-hop discovery-first). This is a thin wrapper over
# the schema-aware solver: it starts from the portal URL and discovers every generated instance fact
# (account, group graph, honored federation claim, IAM escalation family, role/action names) from the
# SERVED evidence, then chains all six hops through the portal's constrained SSRF. It solves the fixed
# Stage-1 instance AND any generated seed, echoing each per-run stage marker (§6.3) and the terminal
# nonce. See blind_solve.py for the logic. Stdlib (python3) + the portal SSRF only.
set -euo pipefail
BASE="${1:-http://target:8080}"
exec python3 "$(dirname "$0")/blind_solve.py" "$BASE"
