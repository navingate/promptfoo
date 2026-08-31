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
# KEEP_VM=1 reuses the VM (and its image cache) between runs — big data saver on a
# metered connection; nothing is re-downloaded that's already cached. Default 0
# (disposable) preserves the safe hygiene default. Reclaim later: colima delete cyber-0a.
KEEP_VM="${KEEP_VM:-0}"

log() { printf '[0a] %s\n' "$*"; }
fail() { printf '[0a][BLOCKER] %s\n' "$*" >&2; exit 1; }

teardown() {
  if [ "$KEEP_VM" = "1" ]; then
    log "KEEP_VM=1 — leaving VM ${PROFILE} up (cache reuse). Remove with: colima delete ${PROFILE}"
    return
  fi
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

# A reused VM may still be egress-locked from the previous run — restore internet
# before (re-)provisioning. Harmless on a fresh VM.
log "restoring egress for provisioning (undo any prior lockdown) ..."
vmssh sudo bash -c '
  iptables -P OUTPUT ACCEPT 2>/dev/null || true
  iptables -F OUTPUT 2>/dev/null || true
  iptables -F DOCKER-USER 2>/dev/null || true
  ip6tables -P OUTPUT ACCEPT 2>/dev/null || true
  ip6tables -F 2>/dev/null || true
' || true

# --- Provision inside the VM (internet ON) ---
log "provisioning harness + images inside the VM (internet on) ..."
vmssh sudo mkdir -p /opt/cyber
# Exclude the gitignored CAISI clone (and any venv/pycache): it's a macOS-built
# tree — copying its .venv poisons the VM ("Exec format error"). setup_caisi.sh
# clones CAISI fresh INSIDE the VM, creating a native-Linux venv.
tar -C "$SKILL_DIR" \
  --exclude='./scripts/vendor/caisi-cyber-evals' \
  --exclude='*/.venv' --exclude='*/__pycache__' --exclude='*/node_modules' \
  -cf - . | vmssh sudo tar -C /opt/cyber -xf - || fail "copy into VM failed"
vmssh sudo chown -R "$(vmssh whoami)" /opt/cyber || true
vmssh mkdir -p /opt/cyber/scripts/vendor || true
# Write a VM-local creds file (chmod 600, never printed) so setup_caisi.sh maps
# AZURE_AI_* -> OPENAI_* inside the VM without needing the laptop path.
vmssh bash -c 'umask 077; cat > /opt/cyber/vm.env' <<EOF
AZURE_AI_BASE_URL=${MODEL_BASE_URL}
AZURE_AI_API_KEY=${AZURE_AI_API_KEY}
EOF
# The disposable VM starts bare — install the toolchain the harness + promptfoo
# need (internet ON, before lockdown). NodeSource gives a modern Node for the
# promptfoo CLI; uv installs user-local to ~/.local/bin.
# Skip the whole toolchain install if a reused VM already has it (saves data).
if vmssh bash -c 'command -v node >/dev/null && command -v npm >/dev/null && command -v promptfoo >/dev/null'; then
  log "toolchain already present in the VM — skipping install (cache reuse)"
else
  log "installing base toolchain in the VM (git, python3, node) ..."
  vmssh sudo bash -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git python3 python3-venv python3-pip curl ca-certificates
    command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs; }
  ' || fail "VM base toolchain install failed"
  # promptfoo is a large npm package — on a metered/slow link this can take several
  # minutes. Keep its progress VISIBLE (silencing it to /dev/null made a slow
  # download look like a hang) and cap it with a timeout so a genuinely stuck
  # download fails loudly instead of hanging forever. With KEEP_VM=1 it runs once,
  # then the cached binary is reused.
  if vmssh bash -c 'command -v promptfoo >/dev/null'; then
    log "promptfoo CLI already present in the VM — skipping (cache reuse)"
  else
    log "installing promptfoo CLI in the VM (large npm download; can take several minutes on a slow link) ..."
    vmssh sudo bash -c 'timeout 1200 npm i -g promptfoo --no-fund --no-audit --loglevel=http' \
      || fail "promptfoo CLI install failed/timed out (npm registry unreachable or download too slow). Re-run; KEEP_VM=1 keeps prior progress."
  fi
fi
# Install uv from PyPI (reliable; apt/nodesource reached the VM fine) rather than
# the astral.sh script (it timed out from the VM). Fail loudly — do NOT let a
# broken download slip through (curl|sh returns sh, masking curl errors).
log "installing uv in the VM (from PyPI; small) ..."
vmssh bash -c '
  set -e
  command -v uv >/dev/null && exit 0
  python3 -m pip install --user -q uv 2>/dev/null \
    || python3 -m pip install --user --break-system-packages -q uv 2>/dev/null \
    || { for i in 1 2 3; do curl -fsSL -o /tmp/uv.sh https://astral.sh/uv/install.sh \
           && sh /tmp/uv.sh && break || sleep 5; done; }
  [ -x "$HOME/.local/bin/uv" ] || command -v uv >/dev/null
' || fail "uv install failed (VM could not reach PyPI or astral.sh)"

vmssh bash -c 'export PATH="$HOME/.local/bin:$PATH"; BUILD_CHALLENGE_TARGETS=0 HALO_ENV=/opt/cyber/vm.env bash /opt/cyber/scripts/setup_caisi.sh' \
  || fail "in-VM setup failed"

# Pre-build the authored sandbox images while the internet is still up, so the
# eval can bring the sandbox up AFTER lockdown with no pull/build egress. The
# smoke target's `build:` would otherwise pull python:3.12-alpine at eval time —
# which the lockdown blocks.
log "pre-building the authored sandbox images (before lockdown) ..."
# Pull only if not already cached (data saver on a reused VM).
vmssh bash -c 'docker image inspect python:3.12-alpine >/dev/null 2>&1 || docker pull python:3.12-alpine >/dev/null 2>&1' \
  || log "WARN: python base pull failed"
vmssh bash -c 'docker image inspect alpine:latest >/dev/null 2>&1 || docker pull alpine:latest >/dev/null 2>&1' || true
vmssh bash -c 'cd /opt/cyber/tasks/_smoke && docker compose build target' \
  || log "WARN: pre-build of smoke target failed (eval may need to rebuild)"

# --- Lock down egress (internet OFF except the model endpoint) ---
MODEL_IP="$(vmssh getent hosts "$MODEL_HOST" | awk '{print $1; exit}')"
[ -n "${MODEL_IP:-}" ] || fail "could not resolve $MODEL_HOST inside the VM"
log "locking down egress; only ${MODEL_HOST} (${MODEL_IP}:${MODEL_PORT}) allowed ..."
vmssh sudo bash /opt/cyber/deploy/egress-lockdown.sh "$MODEL_IP" "$MODEL_PORT" || fail "lockdown failed"

# --- HARD GATE: prove the boundary before any task runs ---
log "running egress self-test (hard gate) ..."
vmssh bash /opt/cyber/deploy/egress-selftest.sh "$MODEL_IP" "$MODEL_PORT" \
  || fail "egress self-test FAILED — refusing to run diagnostics"

# --- Run the diagnostics inside the VM ---
# The task set comes from the config's `tests:` (task guard above validated the
# requested ids; the smoke config runs pfcyber-smoke). `--description` stamps the
# run development-only. Full base URL used verbatim (handles Azure's /openai/v1);
# the key comes from the VM-local vm.env, never a command line.
log "running the authored eval inside the VM (config-driven; label=gate0a-dev) ..."
timeout "$TIMEOUT_SECS" vmssh bash -lc "
  set -a; . /opt/cyber/vm.env; set +a
  cd /opt/cyber/scripts &&
  export PROMPTFOO_PYTHON=/opt/cyber/scripts/vendor/caisi-cyber-evals/.venv/bin/python &&
  export OPENAI_BASE_URL='${MODEL_BASE_URL}' OPENAI_API_KEY=\"\$AZURE_AI_API_KEY\" &&
  promptfoo eval -c promptfooconfig.authored.yaml --no-cache --description 'gate0a-dev (development-only; not assurance-grade)' -o /opt/cyber/out.json
"
rc=$?
[ "$rc" -eq 124 ] && fail "run exceeded ${TIMEOUT_SECS}s — VM will be force-deleted by teardown"

# --- Fetch results out before teardown ---
vmssh cat /opt/cyber/out.json > "$SKILL_DIR/out.gate0a.json" 2>/dev/null \
  && log "results → $SKILL_DIR/out.gate0a.json" \
  || log "WARN: no results file produced (rc=$rc)"

log "done (rc=$rc). VM teardown runs on exit."
exit "$rc"
