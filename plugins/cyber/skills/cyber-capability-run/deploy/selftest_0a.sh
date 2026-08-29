#!/usr/bin/env bash
# Gate 0A boundary proof (fast path) — boots the disposable VM, applies the egress
# lockdown, and runs the egress self-test, then tears the VM down. This is the Gate
# 0A ACCEPTANCE check and needs only colima + docker — NOT the harness/uv/node/
# promptfoo (that's run_0a.sh's job). Use this to sign off 3A.2/3A.3.
#
# Usage:  bash selftest_0a.sh          # reads the model endpoint from HALO_ENV
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="cyber-0a"
HALO_ENV="${HALO_ENV:-/Users/navnn/Documents/AstrowareProjects/halo-dataline/.env}"

log() { printf '[0a-selftest] %s\n' "$*"; }
fail() { printf '[0a-selftest][BLOCKER] %s\n' "$*" >&2; exit 1; }
teardown() {
  log "tearing down VM ${PROFILE} ..."
  colima delete -f "$PROFILE" >/dev/null 2>&1 || true
}
trap teardown EXIT INT TERM

command -v colima >/dev/null || fail "colima not installed"
command -v python3 >/dev/null || fail "python3 needed to parse the endpoint URL"

# Native-arm64 preflight (x86 Colima under Rosetta dies at VM boot).
if [ "$(uname -m)" = "arm64" ] && command -v file >/dev/null; then
  file "$(command -v colima)" 2>/dev/null | grep -q "x86_64" &&
    fail "colima is x86_64 (Rosetta). Reinstall native: /opt/homebrew/bin/brew install colima lima"
fi

[ -f "$HALO_ENV" ] || fail "creds file not found: $HALO_ENV"
set -a
# shellcheck disable=SC1090
source "$HALO_ENV"
set +a
: "${AZURE_AI_BASE_URL:?AZURE_AI_BASE_URL missing}"
read -r MODEL_HOST MODEL_PORT < <(python3 -c '
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
print(u.hostname, u.port or (443 if u.scheme=="https" else 80))
' "$AZURE_AI_BASE_URL")
[ -n "${MODEL_HOST:-}" ] || fail "could not parse host from AZURE_AI_BASE_URL"
log "model endpoint (the one allowed hole): ${MODEL_HOST}:${MODEL_PORT}"

mkdir -p "$HOME/.colima/$PROFILE"
cp "$SCRIPT_DIR/colima-0a.yaml" "$HOME/.colima/$PROFILE/colima.yaml"
log "starting disposable VM ${PROFILE} ..."
colima start --profile "$PROFILE" || fail "colima start failed"
vmssh() { colima ssh --profile "$PROFILE" -- "$@"; }

# Pre-pull alpine (internet ON) so the container-context probe has an image.
log "pulling alpine for the container-context probe (internet on) ..."
vmssh docker pull alpine:latest >/dev/null 2>&1 || log "WARN: alpine pull failed; container probe may skip"

# Copy just the two lockdown/self-test scripts in.
vmssh sudo mkdir -p /opt/cyber/deploy
for f in egress-lockdown.sh egress-selftest.sh; do
  vmssh sudo tee "/opt/cyber/deploy/$f" >/dev/null < "$SCRIPT_DIR/$f"
done

MODEL_IP="$(vmssh getent hosts "$MODEL_HOST" | awk '{print $1; exit}')"
[ -n "${MODEL_IP:-}" ] || fail "could not resolve $MODEL_HOST inside the VM"

log "applying egress lockdown (deny-all except ${MODEL_IP}:${MODEL_PORT}) ..."
vmssh sudo bash /opt/cyber/deploy/egress-lockdown.sh "$MODEL_IP" "$MODEL_PORT" || fail "lockdown failed"

log "running the boundary self-test (the acceptance proof) ..."
vmssh bash /opt/cyber/deploy/egress-selftest.sh "$MODEL_IP" "$MODEL_PORT"
rc=$?
if [ "$rc" -eq 0 ]; then
  log "GATE 0A PROVEN — egress boundary holds from host + container contexts."
else
  log "GATE 0A NOT PROVEN — self-test failed (rc=$rc). Send the [selftest] lines to fix the ruleset."
fi
exit "$rc"
