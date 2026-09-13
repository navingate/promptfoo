#!/usr/bin/env bash
# run.sh — single entry point for the enterprise cyber capability evals.
#
# Covers the Hybrid AD -> Cloud Takeover chain (internal id F2), the Gate-0B substrate, and
# Cybench-via-promptfoo. Two modes:
#
#   smoke              Model-free, host-free, NO credentials. Runs the generator + validator
#                      self-tests, the benign-path check, and the scoring decision-core self-tests in
#                      process. Proves the suite is internally consistent and reproducible on any
#                      machine in seconds. It does NOT run a model or exploit a live target.
#
#   evidence <bench>   The real measured run. Boots the sandboxed estate (docker / microVMs) behind a
#                      default-deny egress broker, drives the model under test, scores STRICTLY (a
#                      capture = the flag submitted as the final answer), and emits a redacted run
#                      manifest + gate report. Needs a host with docker and the model endpoint
#                      credentials in the repo-root .env. <bench> is gate0b | cybench | hybrid-ad.
#
# THIS IS A SANDBOX. Every target is a synthetic, per-run-nonce'd service on an internal-only
# network — there are no real systems, credentials, or data. Secrets are generated per run and
# allowlisted; the harness verifies the flag out of band. Nothing here attacks anything real.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F2="$SKILL_DIR/tasks/F2_ad_cloud_deep"
G0B="$SKILL_DIR/deploy/gate0b"
PY="${PROMPTFOO_PYTHON:-python3}"

usage() {
  cat <<'EOF'
run.sh — enterprise cyber capability evals (SANDBOX: synthetic per-run targets, no real systems)

USAGE
  run.sh smoke                     model-free, host-free suite self-check (seconds; no creds)
  run.sh evidence gate0b [args]    measured Gate-0B run (host: docker/microVMs + model creds)
  run.sh evidence cybench [args]   measured Cybench-in-enterprise run (host + model creds)
  run.sh evidence hybrid-ad        how to run the Hybrid AD -> Cloud Takeover chain (see README)
  run.sh --help

Env: SMOKE_SEEDS (validator seeds in smoke, default 8), PROMPTFOO_PYTHON, CYBER_MODEL.
Credentials for evidence runs live in the repo-root .env (never committed). See README.md.
EOF
}

smoke() {
  echo "== smoke: model-free, host-free suite self-check (no model, no live target) =="
  echo "-- Hybrid AD chain: generator invariants (200 seeds) --"
  "$PY" "$F2/gen.py" --selftest
  echo "-- Hybrid AD chain: service-behavior validator (reachable, resists shortcuts, no leakage) --"
  "$PY" "$F2/validate.py" --seeds "${SMOKE_SEEDS:-8}"
  echo "-- Hybrid AD chain: benign legit-escalation path (gated; inert in a normal run) --"
  "$PY" "$F2/solution/benign_capture.py" --selftest
  echo "-- scoring decision cores + run provenance --"
  "$PY" "$G0B/selftest_measure.py"
  "$PY" "$G0B/selftest_manifest.py"
  "$PY" "$G0B/selftest_run_manifest.py"
  echo "== smoke OK: suite is internally consistent and reproducible on this machine =="
}

evidence() {
  local bench="${1:-}"
  [ $# -gt 0 ] && shift || true
  case "$bench" in
    gate0b)  exec "$G0B/gate0b_host_run.sh" "$@" ;;
    cybench) exec "$SKILL_DIR/deploy/run_cybench_x86.sh" "$@" ;;
    hybrid-ad|f2)
      echo "The Hybrid AD -> Cloud Takeover chain runs via the promptfoo provider against the F2"
      echo "compose (host + model creds required). See README.md 'Run the offense chain (only F2)'."
      echo "Verify it model-free first with:  run.sh smoke"
      exit 2 ;;
    *) echo "usage: run.sh evidence <gate0b|cybench|hybrid-ad> [args...]"; exit 2 ;;
  esac
}

case "${1:-}" in
  smoke)    shift; smoke ;;
  evidence) shift; evidence "$@" ;;
  -h|--help|"") usage ;;
  *) echo "unknown mode: ${1}"; echo; usage; exit 2 ;;
esac
