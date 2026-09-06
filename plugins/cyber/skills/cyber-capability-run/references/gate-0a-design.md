# Gate 0A — development-diagnostics runner (design)

Scope: the isolation floor for **non-sensitive Tier-1 diagnostics** only. Tier-2
scenarios, sensitive/gated tasks, private packs, and any deployment claim require
**Gate 0B** (microVM, out-of-band verifier, anti-cheating, 10-attempt stats) — not
this. Gate 0A's single job: **remove the host-control-plane exposure and give real,
host-layer egress control**, so a dev/SE can run diagnostics reproducibly without
trusting the Docker Compose network as a boundary.

Chosen substrate: **a disposable local Linux VM** (Colima/Lima). Everything —
Docker, Inspect, the task sandbox — runs inside the throwaway VM. The dev laptop's
Docker socket is never mounted into anything.

## Why (the hole this closes)

- Today `deploy/devcontainer.json` mounts `/var/run/docker.sock` → a container (or
  Inspect's out-of-sandbox solver/scorer) can control the host Docker daemon.
- Compose `internal: true` only constrains the **target** container's egress, not
  the evaluator/tools/scorer.
- Fix: put the whole eval inside a disposable VM whose **own** firewall denies
  egress, and never hand any container the real host socket.

## Architecture / data flow

```
dev laptop (promptfoo control only)
   └─ colima VM  "cyber-0a"  (disposable, resource-capped)
        ├─ dockerd (VM-local; laptop socket NOT exposed)
        ├─ inspect + solver + scorer   ← run INSIDE the VM
        └─ task sandbox containers
      nftables (VM): default-DENY egress; allowlist = model endpoint IP:443 only
```

Two phases, because setup needs the internet but the run must not have it:

1. **Provision (internet ON):** create the VM, `uv sync` the harness, build the
   agent + selected target images.
2. **Lock down (internet OFF):** resolve the model endpoint host once, apply the
   nftables default-deny + single allowlist, then run diagnostics. The model call
   is the only permitted egress.
3. **Teardown:** `colima delete` the profile — no residue on the laptop.

## Components to build

1. **`deploy/colima-0a.yaml`** — VM profile: pinned CPU/memory/disk, a dedicated
   profile name (`cyber-0a`), no laptop mounts beyond the read-only workspace.
2. **`deploy/egress-lockdown.sh`** (runs _inside_ the VM) — nftables policy:
   `drop` all output by default; drop IPv6 entirely; drop 169.254.169.254 (IMDS)
   and link-local; drop external DNS; **accept** only the resolved model endpoint
   IP:port and the internal Docker bridge. Idempotent; prints the effective ruleset.
3. **`deploy/run_0a.sh`** (runs on the laptop) — orchestrates provision → build →
   lock-down → `promptfoo eval` (inside the VM) → teardown. Stamps results
   **`env=gate0a-dev`** (development-only label) and refuses to run any task whose
   manifest `sensitivity` is `high` or whose disposition is `gated`/`redesign`.
4. **Devcontainer change** — remove the `/var/run/docker.sock` mount + host binds;
   repoint the devcontainer at the VM (or drop it in favor of `run_0a.sh`).
5. **Kill switch + limits + cleanup** — VM-level resource caps (from the profile);
   a `run_0a.sh` timeout that force-`colima delete`s on breach; a trap that tears
   the VM down on any exit (success, failure, or Ctrl-C).
6. **3A.4 boundary confirmation** — a short `references/inspect-boundary.md` note
   citing Inspect's sandboxing docs, plus an **egress self-test that runs from the
   scorer/solver context** (not only the target container) to prove the VM firewall
   contains the pieces Inspect runs outside the sandbox.

## Gate 0A exit criteria (must pass before any diagnostic counts)

- From **every** task-controlled context inside the VM (target, agent/tools, and
  the eval/solver/scorer process): reaching the internet, IMDS, external DNS, the
  gateway, or any IPv6 destination **fails**; only the model endpoint is reachable.
- No container can reach a host Docker socket or a laptop bind mount.
- The VM and all containers/volumes are gone after teardown, including after a
  forced-failure run.
- Results carry the `gate0a-dev` label; sensitive/gated tasks are refused.

## What I can do here vs. what needs your machine

- **Author + self-check here:** the Colima profile, the nftables lockdown script,
  `run_0a.sh`, the devcontainer edit, and a static egress self-test — plus verify
  syntax and logic.
- **Needs your host (can't run in this session):** actually booting the VM and the
  end-to-end egress proof — this session can't run a VM, and Docker image builds
  here are blocked by the environment's IPv6/DNS limitation. So Gate 0A lands as
  reviewed, runnable scripts + a self-test you execute once to confirm the exit
  criteria.

## Risks / tradeoffs

- A local VM is Gate 0A-grade, **not** assurance-grade: it shares a physical host
  and relies on the hypervisor. That is why Tier-2/sensitive stay behind Gate 0B
  (microVM). Stated so nobody mistakes 0A for containment sufficient for deployment
  claims.
- Colima/Lima is macOS/Linux-friendly; a Windows dev would need WSL2 or a cloud
  runner (the Gate 0B direction). Noted, not solved here.
