#!/usr/bin/env bash
# Gate 0A runner — execute non-sensitive Tier-1 dev diagnostics inside a
# disposable, egress-denied Colima VM. Nothing runs on the laptop's Docker; the
# host socket is never exposed; the VM is deleted on every exit.
#
# Flow: read the model endpoint + key from the creds file → seed VM profile →
# colima start → provision harness+images inside the VM (internet ON) → resolve
# the model host → egress-lockdown (internet OFF except the model) → egress-selftest
# (HARD GATE) → promptfoo eval INSIDE the VM (stamped gate0a-dev) → fetch results →
# teardown. See references/gate-0a-design.md.
#
# NOTE: authored + syntax-checked in a session that cannot boot a VM. Validate on a
# real macOS/Linux host once; the self-test is the acceptance proof.
#
# Usage:
#   bash run_0a.sh [taskid ...]         # reads creds from HALO_ENV (default path)
#   HALO_ENV=/path/.env bash run_0a.sh  # point at a different creds file
# Creds file must define AZURE_AI_BASE_URL + AZURE_AI_API_KEY (OpenAI-compatible).
# Default task: pfcyber-smoke (Wave 0 plumbing).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE="cyber-0a"
TIMEOUT_SECS="${TIMEOUT_SECS:-2400}"
TASKS=("${@:-pfcyber-smoke}")
HALO_ENV="${HALO_ENV:-/Users/navnn/Documents/AstrowareProjects/halo-dataline/.env}"

log() { printf '[0a] %s\n' "$*"; }
fail() { printf '[0a][BLOCKER] %s\n' "$*" >&2; exit 1; }

teardown() {
  log "tearing down VM ${PROFILE} ..."
  colima delete -f "$PROFILE" >/dev/null 2>&1 || true
}
trap teardown EXIT INT TERM

command -v colima >/dev/null || fail "colima not installed (brew install colima docker)"
command -v node >/dev/null || fail "node needed for the sensitivity guard"
command -v python3 >/dev/null || fail "python3 needed to parse the endpoint URL"

# Preflight: on Apple Silicon, Lima/Colima must be NATIVE arm64. An x86_64 build
# under Rosetta fails at VM boot ("limactl is running under rosetta"). Fail early
# with the fix instead of the cryptic Lima error.
if [ "$(uname -m)" = "arm64" ] && command -v file >/dev/null; then
  cbin="$(command -v colima)"
  if file "$cbin" 2>/dev/null | grep -q "x86_64"; then
    fail "colima/limactl at ${cbin} are x86_64 (Rosetta); Lima needs native arm64. Fix:
       /usr/local/bin/brew uninstall colima lima && /opt/homebrew/bin/brew install colima lima
     then ensure 'which colima' resolves under /opt/homebrew, and re-run."
  fi
fi

# --- Read the target endpoint + key (never echoed) ---
[ -f "$HALO_ENV" ] || fail "creds file not found: $HALO_ENV (set HALO_ENV)"
set -a
# shellcheck disable=SC1090
source "$HALO_ENV"
set +a
: "${AZURE_AI_BASE_URL:?AZURE_AI_BASE_URL missing from $HALO_ENV}"
: "${AZURE_AI_API_KEY:?AZURE_AI_API_KEY missing from $HALO_ENV}"
MODEL_BASE_URL="$AZURE_AI_BASE_URL"
read -r MODEL_HOST MODEL_PORT < <(python3 -c '
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
print(u.hostname, u.port or (443 if u.scheme=="https" else 80))
' "$MODEL_BASE_URL")
[ -n "${MODEL_HOST:-}" ] || fail "could not parse host from AZURE_AI_BASE_URL"
log "target endpoint: ${MODEL_HOST}:${MODEL_PORT} (full base URL used verbatim; key hidden)"

# --- Refuse sensitive/gated tasks: Gate 0A is non-sensitive diagnostics only ---
for t in "${TASKS[@]}"; do
  verdict="$(node -e '
    const fs=require("fs"),p=require("path");
    const m=JSON.parse(fs.readFileSync(p.join(process.argv[1],"tasks","catalog.manifest.json"),"utf8"));
    const id=process.argv[2];
    const a=(m.atomic||[]).find(x=>x.id===id);
    if(!id.startsWith("pfcyber") && !a){ console.log("unknown"); process.exit(0);}   // unknown, not plumbing
    if(!a){ console.log("ok"); process.exit(0);}                                      // plumbing tasks (pfcyber-*)
    const bad = a.sensitivity==="high" || ["gated","redesign","move_l2"].includes(a.disposition);
    console.log(bad?"refuse":"ok");
  ' "$SKILL_DIR" "$t")"
  [ "$verdict" = "refuse" ] && fail "task '$t' is sensitive/gated — Gate 0B only, not 0A"
  [ "$verdict" = "unknown" ] && fail "task '$t' not found in the manifest"
done
log "task guard passed: ${TASKS[*]}"

# --- Boot the disposable VM from the authoritative profile ---
mkdir -p "$HOME/.colima/$PROFILE"
cp "$SCRIPT_DIR/colima-0a.yaml" "$HOME/.colima/$PROFILE/colima.yaml"
log "starting disposable VM ${PROFILE} ..."
colima start --profile "$PROFILE" || fail "colima start failed"

vmssh() { colima ssh --profile "$PROFILE" -- "$@"; }

# --- Provision inside the VM (internet ON) ---
log "provisioning harness + images inside the VM (internet on) ..."
vmssh sudo mkdir -p /opt/cyber
tar -C "$SKILL_DIR" -cf - . | vmssh sudo tar -C /opt/cyber -xf - || fail "copy into VM failed"
vmssh sudo chown -R "$(vmssh whoami)" /opt/cyber || true
# Write a VM-local creds file (chmod 600, never printed) so setup_caisi.sh maps
# AZURE_AI_* -> OPENAI_* inside the VM without needing the laptop path.
vmssh bash -c 'umask 077; cat > /opt/cyber/vm.env' <<EOF
AZURE_AI_BASE_URL=${MODEL_BASE_URL}
AZURE_AI_API_KEY=${AZURE_AI_API_KEY}
EOF
vmssh bash -c 'HALO_ENV=/opt/cyber/vm.env bash /opt/cyber/scripts/setup_caisi.sh' \
  || fail "in-VM setup failed"

# --- Lock down egress (internet OFF except the model endpoint) ---
MODEL_IP="$(vmssh getent hosts "$MODEL_HOST" | awk '{print $1; exit}')"
[ -n "${MODEL_IP:-}" ] || fail "could not resolve $MODEL_HOST inside the VM"
log "locking down egress; only ${MODEL_HOST} (${MODEL_IP}:${MODEL_PORT}) allowed ..."
vmssh sudo bash /opt/cyber/deploy/egress-lockdown.sh "$MODEL_IP" "$MODEL_PORT" || fail "lockdown failed"

# --- HARD GATE: prove the boundary before any task runs ---
log "running egress self-test (hard gate) ..."
vmssh bash /opt/cyber/deploy/egress-selftest.sh "$MODEL_IP" "$MODEL_PORT" \
  || fail "egress self-test FAILED — refusing to run diagnostics"

# --- Run the diagnostics inside the VM, stamped development-only ---
SAMPLES="$(IFS=,; echo "${TASKS[*]}")"
log "running diagnostics inside the VM: ${SAMPLES} (label=gate0a-dev) ..."
# The full base URL is used verbatim (handles Azure's /openai/v1 path); the key
# comes from the VM-local vm.env, never from the command line.
timeout "$TIMEOUT_SECS" vmssh bash -lc "
  set -a; . /opt/cyber/vm.env; set +a
  cd /opt/cyber/scripts &&
  export PROMPTFOO_PYTHON=/opt/cyber/scripts/vendor/caisi-cyber-evals/.venv/bin/python &&
  export OPENAI_BASE_URL='${MODEL_BASE_URL}' OPENAI_API_KEY=\"\$AZURE_AI_API_KEY\" PROMPTFOO_EVAL_ENV=gate0a-dev &&
  promptfoo eval -c promptfooconfig.authored.yaml -T samples=${SAMPLES} --no-cache -o /opt/cyber/out.json
"
rc=$?
[ "$rc" -eq 124 ] && fail "run exceeded ${TIMEOUT_SECS}s — VM will be force-deleted by teardown"

# --- Fetch results out before teardown ---
vmssh cat /opt/cyber/out.json > "$SKILL_DIR/out.gate0a.json" 2>/dev/null \
  && log "results → $SKILL_DIR/out.gate0a.json" \
  || log "WARN: no results file produced (rc=$rc)"

log "done (rc=$rc). VM teardown runs on exit."
exit "$rc"
