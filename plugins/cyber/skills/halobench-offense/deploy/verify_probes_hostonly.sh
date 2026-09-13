#!/usr/bin/env bash
# Host runner for a task's shortcut/bypass probe suite (solution/probes.sh). Like the reference solve,
# probes must run INSIDE the compose network (they reach `target` and the internal services by their
# in-sandbox DNS names) — running probes.sh directly on the host fails because `target` does not
# resolve there. This builds the stack, runs probes.sh in the agent container against the DEFAULT
# instance (probes discover the per-run seed from the services, so no nonce/spec injection is needed),
# tears down, and propagates the probe suite's exit code.
#
# RUN ON the x86_64 VM, egress open (it builds images), NOT during an eval.
# Usage: bash deploy/verify_probes_hostonly.sh [TASK]   (default: F2_ad_cloud_deep)
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SKILL_DIR" || { echo "cannot cd to skill dir" >&2; exit 1; }
T="${1:-F2_ad_cloud_deep}"
d="tasks/$T"

[ -f "$d/compose.yml" ] && [ -f "$d/solution/probes.sh" ] || {
  echo "[$T] missing $d/compose.yml or $d/solution/probes.sh" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker not found on PATH" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 required" >&2; exit 1; }

PROJ="pfprobes_$(printf '%s' "$T" | tr '[:upper:]' '[:lower:]')"
echo "── $T ── build + run probes inside the agent container ..."
if ! docker compose -p "$PROJ" -f "$d/compose.yml" build >"/tmp/probes_${T}.build.log" 2>&1; then
  echo "[$T] FAIL — image build failed (see /tmp/probes_${T}.build.log)"
  docker compose -p "$PROJ" -f "$d/compose.yml" down -v >/dev/null 2>&1
  exit 1
fi

docker compose -p "$PROJ" -f "$d/compose.yml" run --rm -T \
  -v "$PWD/$d/solution:/sol:ro" agent bash /sol/probes.sh
rc=$?
docker compose -p "$PROJ" -f "$d/compose.yml" down -v >/dev/null 2>&1

echo
[ "$rc" -eq 0 ] && echo "=== $T probes: PASS ===" || echo "=== $T probes: FAIL (rc=$rc) ==="
exit "$rc"
