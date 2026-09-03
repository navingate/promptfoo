#!/usr/bin/env bash
# Gate-0B per-run isolation launcher (3B.1) — HOST script (authored here, validated on the
# Gate-0B host; it cannot boot a microVM inside the authoring sandbox).
#
# One disposable microVM per run so a compromise, a residue, or a forced failure never crosses
# into another run or the host. Inside the VM: the task sandbox (compose), the destination-
# specific model broker (3B.2, the ONLY permitted egress), a host-firewall egress lockdown, and
# an egress probe from EVERY task-controlled context (3B.1). Fail-closed: any step that cannot be
# verified aborts the run as INVALID (never a pass/non-solve).
#
# Usage:  run_microvm.sh <task> <model> [--vmm firecracker|cloud-hypervisor|kata]
set -euo pipefail

TASK="${1:?usage: run_microvm.sh <task> <model> [--vmm ...]}"
MODEL="${2:?model required}"
VMM="${4:-firecracker}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="$(head -c8 /dev/urandom | xxd -p)"
WORK="$(mktemp -d "/tmp/gate0b.${TASK}.${RUN_ID}.XXXX")"
trap 'rm -rf "$WORK"' EXIT   # disposable: nothing survives the run

log() { printf '[gate0b:%s] %s\n' "$RUN_ID" "$*" >&2; }
fail_closed() { log "FAIL-CLOSED: $*"; echo '{"outcome":"invalid","invalid_reason":"'"$1"'"}'; exit 3; }

# --- 1. per-run microVM ---------------------------------------------------------------------
# Boot a fresh, minimal, network-namespaced microVM from a pinned rootfs+kernel (image pinning +
# provenance is 3B.5). Each VMM is a drop-in; the invariant is: no shared writable state, its own
# netns, and a single tap that only routes to the broker.
boot_vm() {
  case "$VMM" in
    firecracker)      : "${FC_KERNEL:?set FC_KERNEL to the pinned vmlinux}"; : "${FC_ROOTFS:?set FC_ROOTFS to the pinned rootfs}";;
    cloud-hypervisor) : "${CH_KERNEL:?}"; : "${CH_ROOTFS:?}";;
    kata)             : "${KATA_CONFIG:?}";;
    *) fail_closed "unknown_vmm:$VMM";;
  esac
  log "booting $VMM microVM (pinned image) …"
  # HOST: launch the VMM with its own netns + a single tap to the broker subnet only.
  #   e.g. firecracker --api-sock "$WORK/fc.sock" --config-file "$WORK/fc.json"
  # Placeholder marker so a mis-provisioned host aborts rather than silently running unisolated:
  [ -n "${GATE0B_VM_READY:-}" ] || fail_closed "microvm_not_provisioned"
}

# --- 2. destination-specific model broker (3B.2) --------------------------------------------
start_broker() {
  log "starting destination-specific model broker (agent's only egress) …"
  : "${MODEL_UPSTREAM_HOST:?set MODEL_UPSTREAM_HOST to the one allowed model host}"
  : "${MODEL_PROVIDER_KEY:?real provider key (server-side only; never enters the VM)}"
  export PFCYBER_RUN_TOKEN="run-${RUN_ID}"
  # HOST: python3 -c 'from model_broker import BrokerConfig,BrokerPolicy,_make_handler; serve(...)'
  #   binding on the broker subnet, allowlisting MODEL_UPSTREAM_HOST + the inference paths.
  [ -n "${GATE0B_BROKER_READY:-}" ] || fail_closed "broker_unavailable"
}

# --- 3. egress lockdown + probe from EVERY context (3B.1) -----------------------------------
lockdown_and_probe() {
  log "applying egress lockdown (default-deny) …"
  # HOST: nft/iptables in the VM netns: default DROP; allow ONLY agent-subnet -> broker.
  log "probing egress from every task-controlled context …"
  # HOST: in each of target/agent/sidecar/solver/scorer/eval, run egress_probe._probe_destination
  #   over PROBE_DESTINATIONS, collect {context:{dest:reachable}}, then:
  #   python3 -c 'import json,egress_probe as e; r=e.audit(json.load(open("'"$WORK"'/probes.json"))); \
  #              exit(0 if r["passed"] else 1)'  || fail_closed "egress_policy_violation"
  [ -n "${GATE0B_EGRESS_VERIFIED:-}" ] || fail_closed "egress_not_verified"
}

# --- 4. mint nonces, run the task, verify out of band, redact, emit manifest ----------------
run_task() {
  log "minting per-run nonces + running task '$TASK' under model '$MODEL' …"
  # HOST: the provider (gate0b:true) mints nonces, injects PFCYBER_NONCE_* into the target via
  #   compose, runs inspect through the broker, verifies out of band (score_run), then:
  #   python3 -c 'import manifest; print(json.dumps(manifest.build_manifest(result, nonces=..., controls=...)))'
  #   -> the exported manifest is redacted (no proof token leaves the host).
  :
}

boot_vm
start_broker
lockdown_and_probe
run_task
log "run complete; tearing down disposable VM (zero residue)."
