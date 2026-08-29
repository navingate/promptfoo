#!/usr/bin/env bash
# Gate 0A runner — execute non-sensitive Tier-1 dev diagnostics inside a
# disposable, egress-denied Colima VM. Nothing runs on the laptop's Docker; the
# host socket is never exposed; the VM is deleted on every exit.
#
# Flow: seed VM profile → colima start → provision harness+images (internet ON) →
# resolve model IP → egress-lockdown (internet OFF except model) → egress-selftest
# (HARD GATE) → promptfoo eval INSIDE the VM (stamped gate0a-dev) → fetch results →
# teardown. See references/gate-0a-design.md.
#
# NOTE: authored + syntax-checked in a session that cannot boot a VM. Validate on a
# real macOS/Linux host once; the self-test is the acceptance proof.
#
# Usage:
#   MODEL_HOST=llm.internal.example.com MODEL_PORT=443 bash run_0a.sh [taskid ...]
# Default task: pfcyber-smoke (Wave 0 plumbing).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE="cyber-0a"
TIMEOUT_SECS="${TIMEOUT_SECS:-2400}"
TASKS=("${@:-pfcyber-smoke}")
MODEL_HOST="${MODEL_HOST:?set MODEL_HOST to your model endpoint host}"
MODEL_PORT="${MODEL_PORT:-443}"

log() { printf '[0a] %s\n' "$*"; }
fail() { printf '[0a][BLOCKER] %s\n' "$*" >&2; exit 1; }

teardown() { log "tearing down VM ${PROFILE} ..."; colima delete -f "$PROFILE" >/dev/null 2>&1 || true; }
trap teardown EXIT INT TERM

command -v colima >/dev/null || fail "colima not installed (brew install colima docker)"
command -v node >/dev/null || fail "node needed for the sensitivity guard"

# --- Refuse sensitive/gated tasks: Gate 0A is non-sensitive diagnostics only ---
for t in "${TASKS[@]}"; do
  verdict="$(node -e '
    const fs=require("fs"),p=require("path");
    const m=JSON.parse(fs.readFileSync(p.join(process.argv[1],"tasks","catalog.manifest.json"),"utf8"));
    const id=process.argv[2];
    const a=(m.atomic||[]).find(x=>x.id===id);
    if(!id.startsWith("pfcyber") && !a){ console.log("unknown"); process.exit(0);}    // smoke/plumbing ok
    if(!a){ console.log("ok"); process.exit(0);}                                       // plumbing tasks
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
# copy the skill (scripts, tasks) into the VM; the laptop dir is never mounted writable
tar -C "$SKILL_DIR" -cf - . | vmssh sudo tar -C /opt/cyber -xf - || fail "copy into VM failed"
vmssh bash /opt/cyber/scripts/setup_caisi.sh || fail "in-VM setup failed"

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
timeout "$TIMEOUT_SECS" vmssh bash -lc "
  cd /opt/cyber/scripts &&
  export PROMPTFOO_PYTHON=/opt/cyber/scripts/vendor/caisi-cyber-evals/.venv/bin/python &&
  OPENAI_BASE_URL='https://${MODEL_HOST}:${MODEL_PORT}/v1' PROMPTFOO_EVAL_ENV=gate0a-dev \
  promptfoo eval -c promptfooconfig.authored.yaml -T samples=${SAMPLES} --no-cache -o /opt/cyber/out.json
"
rc=$?
[ "$rc" -eq 124 ] && fail "run exceeded ${TIMEOUT_SECS}s — VM will be force-deleted by teardown"

# --- Fetch results out before teardown ---
vmssh cat /opt/cyber/out.json > "$SCRIPT_DIR/../out.gate0a.json" 2>/dev/null \
  && log "results → $(cd "$SCRIPT_DIR/.." && pwd)/out.gate0a.json" \
  || log "WARN: no results file produced (rc=$rc)"

log "done (rc=$rc). VM teardown runs on exit."
exit "$rc"
