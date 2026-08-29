#!/usr/bin/env bash
# Gate 0A egress self-test — the AUTHORITATIVE proof that the lockdown holds.
# RUN INSIDE the cyber-0a VM, AFTER egress-lockdown.sh. Exits non-zero if any
# check fails, so run_0a.sh / selftest_0a.sh (and CI) can gate on it.
#
# Probes from TWO task-controlled contexts and asserts internet / IMDS / external
# DNS / IPv6 are UNREACHABLE while the model endpoint IS reachable:
#   - VM host  (where Inspect's eval/solver/scorer run, OUTSIDE the sandbox):
#     tested with bash /dev/tcp (the Ubuntu host has bash).
#   - a container on a docker network (target/tools): tested with busybox `nc`
#     (alpine has no bash / no /dev/tcp).
#
# Usage (inside the VM):  bash egress-selftest.sh <MODEL_IP> [MODEL_PORT]
set -uo pipefail

MODEL_IP="${1:?model endpoint IP required}"
MODEL_PORT="${2:-443}"
IMG="alpine:latest"
fails=0

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

# host TCP connect via bash /dev/tcp
h() { timeout "$2" bash -c "exec 3<>/dev/tcp/$1"; } # h "ip/port" timeout
# container TCP connect via busybox nc inside alpine
c() { docker run --rm "$IMG" sh -c "timeout 6 nc -w 4 $3 $1 $2 </dev/null"; } # c ip port [extra]

echo "[selftest] context 1/2: VM host (eval / solver / scorer origin)"
blocked "internet (1.1.1.1:443)" h "1.1.1.1/443" 5
blocked "IMDS (169.254.169.254:80)" h "169.254.169.254/80" 5
blocked "external DNS (8.8.8.8:53)" h "8.8.8.8/53" 5
blocked "IPv6 (2606:4700:4700::1111:443)" h "2606:4700:4700::1111/443" 5
allowed "model endpoint (${MODEL_IP}:${MODEL_PORT})" h "${MODEL_IP}/${MODEL_PORT}" 8

echo "[selftest] context 2/2: container on a docker network"
if docker image inspect "$IMG" >/dev/null 2>&1 || docker pull "$IMG" >/dev/null 2>&1; then
  blocked "internet (1.1.1.1:443)" c 1.1.1.1 443 ""
  blocked "IMDS (169.254.169.254:80)" c 169.254.169.254 80 ""
  blocked "external DNS (8.8.8.8:53)" c 8.8.8.8 53 ""
  blocked "IPv6 (2606:4700:4700::1111:443)" c 2606:4700:4700::1111 443 "-6"
  allowed "model endpoint (${MODEL_IP}:${MODEL_PORT})" c "${MODEL_IP}" "${MODEL_PORT}" ""
else
  echo "  ! could not obtain the alpine image to probe from a container"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "[selftest] PASS — egress boundary holds from host and container contexts."
  exit 0
fi
echo "[selftest] FAIL — $fails check(s) wrong. Do NOT trust a run until this passes."
exit 1
