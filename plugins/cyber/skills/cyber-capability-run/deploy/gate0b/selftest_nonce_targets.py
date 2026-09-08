#!/usr/bin/env python3
"""Self-test the Gate-0B target wiring: compose passthrough completeness.

One property, in software (no docker/inspect):

  COMPOSE PASSTHROUGH COMPLETENESS. For the kept Hybrid AD -> Cloud Takeover chain
  (internal id F2, tasks/F2_ad_cloud_deep), every build-backed service that reads a
  PFCYBER_NONCE_<KEY> forwards exactly those keys via `environment:`, and the `agent`
  service forwards none — the per-run nonce never enters the agent's env, a security
  invariant of Gate-0B.

Pure stdlib. Run:  python3 selftest_nonce_targets.py

(Before the plugin was pruned to its keepers this also round-tripped the
non-standard-form flags — B1/FO1/FO2/FO3 — and the file-baked Dockerfile writes of
the broader authored suite. Those tasks were removed, so only the compose-passthrough
check for the kept chain remains.)
"""
import re
import sys
from pathlib import Path

TASKS = Path(__file__).resolve().parent.parent.parent / "tasks"
KEY_RE = re.compile(r"PFCYBER_NONCE_(\w+)")
FAILS = []


def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {extra}" if extra else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------------------
# compose passthrough completeness (stdlib line-walk of the compose format)
# ---------------------------------------------------------------------------
def parse_compose(path):
    """{service: {'context': str|None, 'env': set[str]}} via indentation walk (no yaml dep)."""
    services, cur, in_services = {}, None, False
    lines = path.read_text().splitlines()
    for ln in lines:
        if ln.rstrip() == "services:":
            in_services = True
            continue
        if in_services and ln and not ln[0].isspace() and not ln.startswith("#"):
            in_services = False
        if not in_services:
            continue
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", ln)
        if m:
            cur = m.group(1)
            services[cur] = {"context": None, "env": set()}
            continue
        if cur is None:
            continue
        # context: block style (`context: ./x` on its own line) OR compose flow style
        # (`build: { context: ./x }`) — search, not full-line match, to catch both.
        cm = re.search(r"context:\s*([^\s},]+)", ln)
        if cm:
            services[cur]["context"] = cm.group(1)
        # a forwarded nonce key, tolerating a trailing `# comment` on the list entry
        em = re.match(r"^\s*-\s*(PFCYBER_NONCE_\w+)\s*(?:#.*)?$", ln)
        if em:
            services[cur]["env"].add(em.group(1))
    return services


def keys_in_context(ctx_dir):
    keys = set()
    if not ctx_dir.is_dir():
        return keys
    for f in ctx_dir.rglob("*"):
        if not f.is_file() or "__pycache__" in f.parts:
            continue
        try:
            keys.update("PFCYBER_NONCE_" + k for k in KEY_RE.findall(f.read_text()))
        except (UnicodeDecodeError, OSError):
            pass
    return keys


print("== compose passthrough completeness ==")
services_wired = 0
for compose in sorted(TASKS.glob("*/compose.yml")):
    svcs = parse_compose(compose)
    for name, info in svcs.items():
        referenced = keys_in_context((compose.parent / info["context"]).resolve()) if info["context"] else set()
        if name == "agent":
            check(f"{compose.parent.name}/agent forwards no nonce", not info["env"])
            continue
        if referenced:
            services_wired += 1
            check(f"{compose.parent.name}/{name} forwards exactly its keys",
                  info["env"] == referenced, f"env={sorted(info['env'])} refs={sorted(referenced)}")
        else:
            check(f"{compose.parent.name}/{name} forwards nothing (reads no nonce)", not info["env"])
# F2 is the only authored task kept, so the floor is 1 (its kill-chain services read per-run
# nonces); the per-service exactness checks above carry the real assurance.
check("wired at least one nonce-backed service", services_wired >= 1, f"wired={services_wired}")

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS[:12]}{' ...' if len(FAILS) > 12 else ''}")
    sys.exit(1)
print("ALL GATE-0B NONCE-TARGET WIRING CHECKS PASSED")
