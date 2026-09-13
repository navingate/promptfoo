#!/usr/bin/env python3
"""Self-test the 4D.4 reproducible-release manifest core.

Proves: identical trees produce an identical manifest digest (reproducible); any single byte change
moves the digest; changing one component does not change another's digest (content isolation); the
manifest carries no proof token even when a component file contains one; and the real committed
tree assembles into a manifest with the expected components.

Pure stdlib. Run:  python3 selftest_release_manifest.py
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAILS = []


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {extra}" if extra else ""))
    if not cond:
        FAILS.append(name)


R = load("pfcyber_release", HERE / "release_manifest.py")

tree = {
    "task/A": {"eval.yml": b"flag: PROMPTFOO{a}\n", "target/app.py": b"print('a')\n"},
    "task/B": {"eval.yml": b"flag: PROMPTFOO{b}\n"},
    "verifier": {"nonce_broker.py": b"# broker\n"},
}

print("== reproducibility ==")
m1 = R.build(tree)
m2 = R.build({k: dict(v) for k, v in tree.items()})  # a fresh copy of the same bytes
check("identical trees -> identical manifest digest", m1["manifest_digest"] == m2["manifest_digest"])
check("manifest lists all components", set(m1["components"]) == {"task/A", "task/B", "verifier"})

print("== sensitivity + isolation ==")
tree2 = {k: dict(v) for k, v in tree.items()}
tree2["task/A"]["target/app.py"] = b"print('a2')\n"  # flip one file
m3 = R.build(tree2)
check("a byte change moves the top-level digest", m3["manifest_digest"] != m1["manifest_digest"])
check("changed component's digest differs", m3["components"]["task/A"]["digest"] != m1["components"]["task/A"]["digest"])
check("untouched component's digest is stable (isolation)",
      m3["components"]["task/B"]["digest"] == m1["components"]["task/B"]["digest"])

print("== no secret leakage ==")
check("committed flags do not appear in the manifest (digests only)",
      "PROMPTFOO{" not in json.dumps(m1))

print("== assembles the real committed tree ==")
real = R.build(R.collect())
ncomp = len(real["components"])
tasks = [c for c in real["components"] if c.startswith("task/")]
check("real manifest has a top-level digest", len(real["manifest_digest"]) == 64)
check("real manifest covers many task components", len(tasks) >= 40, f"tasks={len(tasks)}")
check("real manifest includes verifier + measurement + provider",
      {"verifier", "measurement", "provider", "anti_cheat"} <= set(real["components"]))
check("real manifest carries no proof token", "PROMPTFOO{" not in json.dumps(real))
# determinism on the real tree (two collects hash the same)
check("real tree is reproducible", R.build(R.collect())["manifest_digest"] == real["manifest_digest"])

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL 4D RELEASE-MANIFEST CHECKS PASSED")
