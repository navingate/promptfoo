# Lightweight DEV stand-in for CAISI's agent-environment image, for the Gate 0A
# authored/smoke path ONLY.
#
# The real CAISI agent image (agent-environment:1.1.1) is an x86_64 Kali build
# (nmap/pwntools/playwright + an i386 multiarch layer). It CANNOT build natively
# on arm64 (the `apt-get install libc6:i386` layer has no arm64 equivalent) and is
# slow + data-heavy to emulate under QEMU (Kali packages + Playwright browsers).
#
# Gate 0A's job is to validate the wrapper PLUMBING (loader -> docker sandbox ->
# agent -> deterministic scorer -> results), NOT CAISI's offensive toolchain. The
# cybench_agent's default tools only need bash, python3, a fetch tool, and
# coreutils `timeout` inside the agent container — so we tag THIS minimal,
# multi-arch image as agent-environment:1.1.1 for local dev runs. Real cyber tasks
# (Gate 0B) run the real Kali image on an x86_64 runner where it is native.
#
# This image intentionally ships NO offensive tooling.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    TERM=xterm

# bash + fetch tools cover what the agent's bash/python tools invoke for a
# plumbing task; coreutils `timeout` (used by the exec wrapper) ships in the base.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The solver defaults to running as root (agent_user="root") and only sources a
# venv when the model opts in (agent_venv="/opt/ucb", off by default). Provide
# both anyway so every path the solver might take resolves cleanly: a real
# /opt/ucb venv, and a 'hacker' user for the challenge-specific tool that execs
# as user=hacker (that tool is a no-op for authored tasks, but this keeps it from
# erroring on a missing user).
RUN python3 -m venv /opt/ucb \
    && useradd -m -s /bin/bash hacker

# Inspect's tool support server — the real agent image installs it (minus the web
# browser). Cheap insurance so Inspect's editor/tool plumbing resolves; the
# cybench_agent's core bash/python tools use direct `docker exec` and don't strictly
# need it, but a missing tool-support server is a common, hard-to-diagnose failure.
ENV PATH="$PATH:/opt/inspect_tool_support/bin"
RUN python3 -m venv /opt/inspect_tool_support \
    && /opt/inspect_tool_support/bin/pip install --no-cache-dir inspect-tool-support \
    && /opt/inspect_tool_support/bin/inspect-tool-support post-install --no-web-browser

LABEL org.promptfoo.cyber.agent-image="gate0a-dev-stand-in" \
      org.promptfoo.cyber.note="minimal plumbing image; NOT the real CAISI Kali agent"

# CRITICAL: Inspect brings the sandbox up with `docker compose up --wait` and execs
# into it — the container must stay alive. The real agent image ends the same way.
# Without this, python:3.12-slim's default CMD (python3) exits and the run fails.
CMD ["sleep", "infinity"]
