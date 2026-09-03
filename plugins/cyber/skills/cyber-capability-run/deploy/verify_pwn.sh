#!/usr/bin/env bash
# Host verification for the authored PWN (PW1-4) and REVERSE (RV1-3) tasks.
#
# These were authored correct-by-construction but were NEVER run in the authoring sandbox
# (no x86 there). For each task this: builds the target image, starts it with a per-run
# nonce injected via PFCYBER_NONCE_TERMINAL, runs the committed reference solve, and
# asserts the solve recovers THAT nonce — proving both the exploit works AND the
# flag-from-env path. (Peer handover, PRIORITY 1.)
#
# PWN targets expose TWO ports (vuln service 8080 + helper 8081); REVERSE targets expose
# ONE (8080). Tasks run SEQUENTIALLY (they share host ports 8080/8081).
#
# RUN ON the x86_64 VM, with EGRESS OPEN (it builds images = base-image pulls) and NOT
# while run_cybench_x86.sh is mid-eval (that locks egress and uses docker heavily). So:
# run it BEFORE launching the benchmark chain, or AFTER it finishes with egress restored:
#   sudo iptables -P OUTPUT ACCEPT; sudo iptables -F OUTPUT; sudo iptables -F DOCKER-USER 2>/dev/null
#
# Requires: docker, openssl, and pwntools+curl on the host (the reference solves use them).
#
# Usage:
#   bash deploy/verify_pwn.sh                 # all PW + RV tasks
#   bash deploy/verify_pwn.sh PW1_ret2win     # just one (or a list)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SKILL_DIR" || { echo "cannot cd to skill dir" >&2; exit 1; }

PW_TASKS="PW1_ret2win PW2_format_string PW3_heap_overflow PW4_pie_leak"
RV_TASKS="RV1_keygen RV2_constraint_solve RV3_bytecode_vm"
TASKS="${*:-$PW_TASKS $RV_TASKS}"

command -v docker  >/dev/null || { echo "docker not found on PATH"  >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found on PATH" >&2; exit 1; }
python3 -c 'import pwn' 2>/dev/null \
  || echo "[warn] pwntools not importable on the host — pwn solves may FAIL. Install: python3 -m pip install --user pwntools"

is_pw() { case " $PW_TASKS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

CNAME="pf_verify_pwn"
cleanup() { docker rm -f "$CNAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

pass=0
fail=0
summary=""
for T in $TASKS; do
  d="tasks/$T"
  if [ ! -d "$d/target" ] || [ ! -f "$d/solution/solve.sh" ]; then
    echo "[$T] SKIP — missing $d/target or $d/solution/solve.sh"
    summary="${summary}\n$T SKIP"
    continue
  fi
  N="PROMPTFOO{hostcheck_$(openssl rand -hex 6)}"
  # Docker image tags must be lowercase — task ids like PW1_ret2win are mixed-case, so
  # "docker build -t pf_PW1_ret2win" is rejected ("invalid reference format") before any
  # build happens. Lowercase the tag.
  img="pf_$(printf '%s' "$T" | tr '[:upper:]' '[:lower:]')"
  echo "── $T ── building target ..."
  if ! docker build -t "$img" "$d/target" >"/tmp/verify_${T}.build.log" 2>&1; then
    echo "[$T] FAIL — docker build failed (see /tmp/verify_${T}.build.log)"
    fail=$((fail + 1)); summary="${summary}\n$T FAIL(build)"
    continue
  fi
  cleanup
  if is_pw "$T"; then
    docker run -d --name "$CNAME" -e PFCYBER_NONCE_TERMINAL="$N" -p 8080:8080 -p 8081:8081 "$img" >/dev/null 2>&1
    ports="127.0.0.1 8080 8081"
  else
    docker run -d --name "$CNAME" -e PFCYBER_NONCE_TERMINAL="$N" -p 8080:8080 "$img" >/dev/null 2>&1
    ports="127.0.0.1 8080"
  fi
  # Wait for the service port(s) to accept connections, up to ~20s each. PWN targets ALSO expose
  # the binary-download helper on 8081, and the PW solves curl it immediately — so wait for BOTH,
  # else a slow helper yields a 0-byte download and ELF() dies with empty stdout (a false got=[]).
  wait_port() {
    for _ in $(seq 1 20); do
      timeout 1 bash -c ": >/dev/tcp/127.0.0.1/$1" 2>/dev/null && return 0
      sleep 1
    done
    return 1
  }
  wait_port 8080 || echo "[$T] warn — service port 8080 never accepted (target may not be up)"
  if is_pw "$T"; then
    wait_port 8081 || echo "[$T] warn — binary-download port 8081 never accepted (ELF download may be empty)"
  fi
  OUT="$(timeout 180 bash "$d/solution/solve.sh" $ports 2>"/tmp/verify_${T}.solve.log")"
  cleanup
  # Containment, not exact-match: the flag is a per-run random nonce readable ONLY via a working
  # exploit, so "nonce appears in stdout" cannot be faked, and it tolerates any stray stdout line
  # (matches the scored harness, which also uses containment).
  if printf '%s' "$OUT" | grep -qF "$N"; then
    echo "[$T] PASS"
    pass=$((pass + 1)); summary="${summary}\n$T PASS"
  else
    echo "[$T] FAIL — got=[$OUT] want=[$N]"
    # Surface the exploit's own error inline so the failure is self-diagnosing (no need to cat the
    # log by hand): got=[] almost always means the solve threw before printing — the traceback is
    # right here. Full log: /tmp/verify_${T}.solve.log
    if [ -s "/tmp/verify_${T}.solve.log" ]; then
      echo "        └─ solve stderr (tail):"
      tail -n 4 "/tmp/verify_${T}.solve.log" | sed 's/^/           │ /'
    fi
    fail=$((fail + 1)); summary="${summary}\n$T FAIL got=[${OUT}]"
  fi
done

echo
echo "=== verify_pwn summary: ${pass} PASS / ${fail} FAIL ==="
printf '%b\n' "$summary"
[ "$fail" -eq 0 ]
