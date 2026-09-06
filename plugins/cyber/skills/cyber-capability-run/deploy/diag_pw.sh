#!/usr/bin/env bash
# Layer-isolating diagnostic for the PWN tasks (PW1-4) when verify_pwn.sh reports FAIL/got=[].
#
# verify_pwn.sh only tells you the solve produced no flag; it can't tell you WHICH layer broke.
# This runs each PW target and probes the three independent layers separately, with NOTHING hidden
# by output redirection, so one paste says exactly where each exploit dies:
#
#   L1 download  — is http://target:8081/vuln actually an x86-64 ELF? (bad download => ELF() throws)
#   L2 banner    — does the socat-exec'd vuln process talk on 8080? (stdlib socket, no pwntools —
#                  isolates "service is dead / binary won't exec" from "exploit/offset is wrong")
#   L3 exploit   — the REAL solve.sh, streams merged (2>&1) and pwntools terminal tricks disabled
#                  (PWNLIB_NOTERM=1) so its own logs + any traceback are visible, not swallowed.
#
# RUN ON the x86_64 VM with EGRESS OPEN (it builds images), NOT during a benchmark eval. From repo
# root:  bash plugins/cyber/skills/cyber-capability-run/deploy/diag_pw.sh
# Or a subset:  bash .../deploy/diag_pw.sh PW1_ret2win
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SKILL_DIR" || { echo "cannot cd to skill dir" >&2; exit 1; }

PW_TASKS="PW1_ret2win PW2_format_string PW3_heap_overflow PW4_pie_leak"
TASKS="${*:-$PW_TASKS}"

command -v docker >/dev/null || { echo "docker not found on PATH" >&2; exit 1; }
python3 -c 'import pwn' 2>/dev/null || echo "[warn] pwntools not importable — L3 will fail at import (that alone would explain got=[])"

CNAME="pf_diag_pw"
cleanup() { docker rm -f "$CNAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

wait_port() {
  for _ in $(seq 1 20); do
    timeout 1 bash -c ": >/dev/tcp/127.0.0.1/$1" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

for T in $TASKS; do
  d="tasks/$T"
  echo; echo "################################## $T ##################################"
  [ -d "$d/target" ] && [ -f "$d/solution/solve.sh" ] || { echo "  SKIP — missing target/ or solution/solve.sh"; continue; }

  N="PROMPTFOO{diag_$(openssl rand -hex 6)}"
  img="pf_$(printf '%s' "$T" | tr '[:upper:]' '[:lower:]')"
  echo "── building $img ..."
  if ! docker build -t "$img" "$d/target" >"/tmp/diag_${T}.build.log" 2>&1; then
    echo "  L0 BUILD FAILED — tail of /tmp/diag_${T}.build.log:"
    tail -n 6 "/tmp/diag_${T}.build.log" | sed 's/^/     /'
    continue
  fi
  cleanup
  docker run -d --name "$CNAME" -e PFCYBER_NONCE_TERMINAL="$N" -p 8080:8080 -p 8081:8081 "$img" >/dev/null 2>&1
  wait_port 8080 || echo "  [!] 8080 never accepted"
  wait_port 8081 || echo "  [!] 8081 never accepted"

  # ---- L1: is the downloadable binary a real ELF? ----
  echo "── L1 download (curl :8081/vuln) ->"
  if curl -sS -m 10 "http://127.0.0.1:8081/vuln" -o "/tmp/diag_${T}.bin" 2>"/tmp/diag_${T}.curl.err"; then
    printf '     size=%s  type=%s\n' "$(wc -c <"/tmp/diag_${T}.bin" | tr -d ' ')" "$(file -b "/tmp/diag_${T}.bin" 2>/dev/null || echo '?')"
  else
    echo "     curl FAILED (exit $?) — $(cat "/tmp/diag_${T}.curl.err")"
  fi

  # ---- L2: does the vuln process actually talk on 8080? (stdlib socket, no pwntools) ----
  echo "── L2 banner (raw socket :8080, send one line, read reply) ->"
  python3 - <<'PY'
import socket
try:
    s = socket.create_connection(("127.0.0.1", 8080), timeout=5)
    s.settimeout(3)
    try:
        banner = s.recv(256)
    except socket.timeout:
        banner = b"<no banner before we send>"
    s.sendall(b"AAAA\n")
    try:
        reply = s.recv(512)
    except socket.timeout:
        reply = b"<no reply / timeout>"
    s.close()
    print("     banner:", banner[:200])
    print("     reply :", reply[:200])
except Exception as e:  # noqa: BLE001
    print(f"     CONNECT FAILED: {type(e).__name__}: {e}")
PY

  # ---- L3: the real solve, streams merged, pwntools term tricks off ----
  echo "── L3 exploit (real solve.sh, 2>&1, PWNLIB_NOTERM=1) ->"
  ports="127.0.0.1 8080 8081"
  PWNLIB_NOTERM=1 timeout 60 bash "$d/solution/solve.sh" $ports 2>&1 | sed 's/^/     /'
  rc=${PIPESTATUS[0]}
  echo "     (solve rc=$rc)  nonce for this run: $N"
  cleanup
done
echo; echo "done. For each task: L1 must be an ELF, L2 must show the service's prompt, L3 must end in the nonce."
