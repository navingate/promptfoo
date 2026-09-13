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

# --- Uniform SUT selection (same CYBER_SUT_ENDPOINT/CYBER_MODEL interface as F2 offense/defense) ---
# CYBER_SUT_ENDPOINT=<name> resolves base_url + key from the shared SUT_ENDPOINTS registry
# (provider.py — the single source of truth) and exports them for Inspect's openai/anthropic
# provider; CYBER_MODEL overrides the model id. Unset → the config.env defaults below, unchanged
# (the endpoint then comes from the harness .env written by setup_caisi.sh). No egress lockdown
# here (that is the x86 runner), so base_url-absent endpoints like `anthropic` work fine.
if [ -n "${CYBER_SUT_ENDPOINT:-}" ]; then
  # Resolve via the single-source registry. Capture FIRST so the resolver's non-zero exit is caught:
  # `eval "$(cmd)" || fail` does NOT catch cmd's failure (its status is discarded as an arg to eval),
  # so a typo'd endpoint would silently fall through to the default model.
  _sut_env="$(python3 "$SCRIPT_DIR/provider.py" --resolve-endpoint "$CYBER_SUT_ENDPOINT")" \
    || fail "unknown CYBER_SUT_ENDPOINT '$CYBER_SUT_ENDPOINT' (see provider.py SUT_ENDPOINTS)"
  # Only eval output that matches the resolver contract — never stale/garbage output (e.g. an older
  # provider.py without --resolve-endpoint), which would otherwise silently fall back to the default model.
  case "$_sut_env" in PFCYBER_SUT_*) : ;; *) fail "provider.py --resolve-endpoint gave unexpected output — is it present and up to date?" ;; esac
  eval "$_sut_env"; unset _sut_env
  [ -n "${PFCYBER_SUT_BASE_URL:-}" ] && export OPENAI_BASE_URL="$PFCYBER_SUT_BASE_URL"
  if [ -n "${PFCYBER_SUT_KEY_ENV:-}" ]; then
    # Pull the key from the repo-root .env ONLY if it is not already in the env — so an inline
    # key wins and an empty .env placeholder can't clobber it.
    if [ -z "$(printenv "$PFCYBER_SUT_KEY_ENV" || true)" ] && [ -f "${HALO_ENV:-}" ]; then
      set -a; . "$HALO_ENV"; set +a
    fi
    _sut_key="$(printenv "$PFCYBER_SUT_KEY_ENV" 2>/dev/null || true)"
    [ -n "$_sut_key" ] || fail "endpoint '$CYBER_SUT_ENDPOINT' needs \$$PFCYBER_SUT_KEY_ENV set (inline or in the repo-root .env)"
    export "${PFCYBER_SUT_KEY_TARGET:-OPENAI_API_KEY}"="$_sut_key"
    unset _sut_key
  fi
  log "SUT endpoint: $CYBER_SUT_ENDPOINT (resolved via provider.py SUT_ENDPOINTS)"
fi
INSPECT_MODEL="${CYBER_MODEL:-$INSPECT_MODEL}"

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
