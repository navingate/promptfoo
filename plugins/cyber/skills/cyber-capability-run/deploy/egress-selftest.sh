#!/usr/bin/env bash
# Gate 0A egress self-test — the AUTHORITATIVE proof that the lockdown holds.
# RUN INSIDE the cyber-0a VM, AFTER egress-lockdown.sh. Exits non-zero if any
# check fails, so run_0a.sh (and CI) can gate on it.
#
# It probes from TWO task-controlled contexts — the VM host (where Inspect's
# eval/solver/scorer run, outside the per-sample sandbox) and a container on a
# docker network — and asserts:
#   - internet / IMDS / external DNS / IPv6 are UNREACHABLE from both, and
#   - the model endpoint IP:port IS reachable (the one allowed hole).
#
# Usage (inside the VM):  bash egress-selftest.sh <MODEL_IP> [MODEL_PORT]
set -uo pipefail

MODEL_IP="${1:?model endpoint IP required}"
MODEL_PORT="${2:-443}"
fails=0

# A blocked probe should FAIL fast; keep timeouts short.
blocked() { # description, command...
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✗ FAIL (reachable, must be blocked): $desc"
    fails=$((fails + 1))
  else
    echo "  ✓ blocked: $desc"
  fi
}
allowed() { # description, command...
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✓ reachable: $desc"
  else
    echo "  ✗ FAIL (blocked, must be reachable): $desc"
    fails=$((fails + 1))
  fi
}

probe_set() { # runner-prefix... (e.g. "" for host, or "docker run ... --")
  local run=("$@")
  blocked "internet (1.1.1.1:443)" "${run[@]}" timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'
  blocked "IMDS (169.254.169.254:80)" "${run[@]}" timeout 5 bash -c 'exec 3<>/dev/tcp/169.254.169.254/80'
  blocked "external DNS (8.8.8.8:53)" "${run[@]}" timeout 5 bash -c 'exec 3<>/dev/tcp/8.8.8.8/53'
  blocked "IPv6 (2606:4700:4700::1111:443)" "${run[@]}" timeout 5 bash -c 'exec 3<>/dev/tcp/2606:4700:4700::1111/443'
  allowed "model endpoint (${MODEL_IP}:${MODEL_PORT})" "${run[@]}" timeout 8 bash -c "exec 3<>/dev/tcp/${MODEL_IP}/${MODEL_PORT}"
}

echo "[selftest] context 1/2: VM host (eval / solver / scorer origin)"
probe_set

echo "[selftest] context 2/2: container on a docker network"
# alpine already present from image pulls; falls back with a clear message.
if docker image inspect alpine:latest >/dev/null 2>&1 || docker pull alpine:latest >/dev/null 2>&1; then
  probe_set docker run --rm alpine:latest
else
  echo "  ! could not obtain alpine image to probe from a container — run after image build"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "[selftest] PASS — egress boundary holds from host and container contexts."
  exit 0
fi
echo "[selftest] FAIL — $fails check(s) wrong. Do NOT trust a run until this passes."
exit 1
