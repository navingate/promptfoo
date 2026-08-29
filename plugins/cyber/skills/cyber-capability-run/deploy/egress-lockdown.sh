#!/usr/bin/env bash
# Gate 0A egress lockdown — RUNS INSIDE the disposable cyber-0a VM, AFTER the
# harness + images are built and BEFORE any task/agent runs.
#
# Default-deny all egress; allow exactly ONE external destination: the model
# endpoint IP:port. Covers both:
#   - OUTPUT  : host-originated traffic (the Inspect eval / solver / scorer, which
#               run outside the per-sample sandbox — the case the review flagged).
#   - DOCKER-USER (FORWARD): container-originated traffic (target, agent/tools).
# IPv6 is dropped wholesale; IMDS (169.254.169.254), external DNS, and the gateway
# are dropped by the default policy (the model IP is pinned, so no runtime DNS).
#
# This is the MECHANISM; deploy/egress-selftest.sh is the AUTHORITATIVE proof.
# Validate on a real VM once (this repo's environment cannot boot one).
#
# Usage (inside the VM):  sudo bash egress-lockdown.sh <MODEL_IP> [MODEL_PORT]
set -euo pipefail

MODEL_IP="${1:?model endpoint IP required (resolve the host once, pass the IP)}"
MODEL_PORT="${2:-443}"

command -v iptables >/dev/null || {
  echo "iptables not found in the VM" >&2
  exit 1
}

# Docker bridge subnets — allow intra-sandbox (agent<->target) traffic to survive.
DOCKER_NETS="$(ip -o -f inet addr show 2>/dev/null | awk '/docker|br-/ {print $4}')"

echo "[lockdown] model allow = ${MODEL_IP}:${MODEL_PORT}; docker nets = ${DOCKER_NETS:-none}"

# --- IPv6: drop everything (no allowlisted v6 destination) ---
if command -v ip6tables >/dev/null; then
  ip6tables -P INPUT DROP
  ip6tables -P FORWARD DROP
  ip6tables -P OUTPUT DROP
  ip6tables -F
  ip6tables -A OUTPUT -o lo -j ACCEPT
  ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fi

# --- IPv4 host egress (eval / solver / scorer originate here) ---
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for net in $DOCKER_NETS; do
  iptables -A OUTPUT -d "$net" -j ACCEPT
done
iptables -A OUTPUT -d "${MODEL_IP}" -p tcp --dport "${MODEL_PORT}" -j ACCEPT
# Explicit belt-and-suspenders drops before the default policy:
iptables -A OUTPUT -d 169.254.0.0/16 -j DROP # IMDS + link-local
iptables -P OUTPUT DROP

# --- IPv4 container egress (forwarded traffic passes through DOCKER-USER) ---
# Docker guarantees DOCKER-USER is traversed first in FORWARD. We append a final
# DROP so anything not explicitly allowed above it is denied.
iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for net in $DOCKER_NETS; do
  # intra-docker (agent <-> target on the same/other sandbox bridge)
  iptables -A DOCKER-USER -s "$net" -d "$net" -j ACCEPT
done
iptables -A DOCKER-USER -d "${MODEL_IP}" -p tcp --dport "${MODEL_PORT}" -j ACCEPT
iptables -A DOCKER-USER -d 169.254.0.0/16 -j DROP
iptables -A DOCKER-USER -j DROP

echo "[lockdown] applied. Effective OUTPUT + DOCKER-USER:"
iptables -S OUTPUT
iptables -S DOCKER-USER
echo "[lockdown] Run egress-selftest.sh to PROVE the boundary before trusting a run."
