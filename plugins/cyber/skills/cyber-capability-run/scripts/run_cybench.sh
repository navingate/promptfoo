#!/usr/bin/env bash
# Run the three chosen Cybench tasks against the target model with CAISI's own
# deterministic flag scorer, under a wall-clock guard so a stalled endpoint can't
# hang forever. Writes Inspect logs to ./logs inside the harness.
#
# Usage:
#   bash run_cybench.sh                 # uses SAMPLES/model from config.env
#   SAMPLES=dynastic bash run_cybench.sh  # override the sample set
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

log() { printf '[run] %s\n' "$*"; }
fail() { printf '[run][BLOCKER] %s\n' "$*" >&2; exit 1; }

[ -d "$CAISI_DIR/.git" ] || fail "harness not set up — run setup_caisi.sh first"
[ -f "$CAISI_DIR/.env" ] || fail "$CAISI_DIR/.env missing — run setup_caisi.sh first"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable"
cd "$CAISI_DIR" || fail "cannot cd into $CAISI_DIR"

# Pick a timeout binary (GNU coreutils `timeout` or macOS `gtimeout`); run
# without one if neither is present.
TIMEOUT_BIN=""
command -v timeout >/dev/null 2>&1 && TIMEOUT_BIN="timeout"
command -v gtimeout >/dev/null 2>&1 && TIMEOUT_BIN="gtimeout"

log "model=$INSPECT_MODEL  samples=$SAMPLES  token-limit=$TOKEN_LIMIT"
log "solver=ucb/cybench_agent  (deterministic includes() flag scorer)"

# --no-fail-on-error so one flaky task doesn't abort the whole set; deterministic
# scoring means the log records flag-captured (C) / incorrect (I) per task.
CMD=( uv run inspect eval ucb/cybench
      -T "samples=${SAMPLES}"
      --solver ucb/cybench_agent
      --model "${INSPECT_MODEL}"
      --token-limit "${TOKEN_LIMIT}"
      --no-fail-on-error )

if [ -n "$TIMEOUT_BIN" ]; then
  log "wall-clock guard: ${EVAL_TIMEOUT_SECS}s via $TIMEOUT_BIN"
  "$TIMEOUT_BIN" "${EVAL_TIMEOUT_SECS}" "${CMD[@]}"
  rc=$?
  [ "$rc" -eq 124 ] && fail "eval exceeded ${EVAL_TIMEOUT_SECS}s wall-clock guard — endpoint likely stalled"
else
  log "WARN: no timeout binary found; running without wall-clock guard"
  "${CMD[@]}"
  rc=$?
fi

log "inspect exited rc=$rc. Read the run with: (cd $CAISI_DIR && uv run inspect view)"
log "A score of 0 captured is a VALID pipe-proof. Record the placeholder-model +"
log "contamination caveats from SKILL.md alongside any number."
exit "$rc"
