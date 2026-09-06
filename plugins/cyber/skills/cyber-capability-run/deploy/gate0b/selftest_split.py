#!/usr/bin/env python3
"""Self-test the 4D.2 public-dev / private-scored split policy.

Proves: a well-formed policy validates; a private id that names a non-existent task is flagged; a
new task is public_dev by default (never silently unclassified); private tasks appear in the public
release only as commitments (never named in the public set); and the committed split.policy.json is
valid against the real task tree.

Pure stdlib. Run:  python3 selftest_split.py
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


S = load("pfcyber_split", HERE / "split.py")

TASKS = ["A1", "S14", "RV1", "PW1", "SECRET1", "SECRET2"]

print("== validation ==")
check("default-only policy is valid", S.validate(TASKS, {"default": "public_dev", "private_scored": []}) == [])
check("private naming a real task is valid",
      S.validate(TASKS, {"private_scored": ["SECRET1"]}) == [])
prob = S.validate(TASKS, {"private_scored": ["NOPE"]})
check("private naming a non-existent task is flagged", any("non-existent" in p for p in prob), str(prob))
check("unknown default disposition is flagged",
      any("default" in p for p in S.validate(TASKS, {"default": "weird"})))

print("== partition + completeness ==")
rel = S.public_release(TASKS, {"default": "public_dev", "private_scored": ["SECRET1", "SECRET2"]})
check("public set excludes private tasks", "SECRET1" not in rel["public_dev"] and "SECRET2" not in rel["public_dev"])
check("public set names the real public tasks", set(rel["public_dev"]) == {"A1", "S14", "RV1", "PW1"})
check("private tasks appear only as commitments", set(rel["private_scored_commitments"]) == {"SECRET1", "SECRET2"})
check("private commitments do not reveal the id verbatim as content",
      all(v.startswith("sha256:") for v in rel["private_scored_commitments"].values()))
check("counts add up", rel["counts"]["public"] + rel["counts"]["private"] == len(TASKS))
# a brand-new task defaults to public_dev (never silently dropped)
rel2 = S.public_release(TASKS + ["BRAND_NEW"], {"private_scored": ["SECRET1"]})
check("a new task is public_dev by default", "BRAND_NEW" in rel2["public_dev"])

print("== committed policy is valid against the real tree ==")
policy = json.loads((HERE / "split.policy.json").read_text())
ids = S._task_ids()
check("real tree has tasks", len(ids) >= 40, f"tasks={len(ids)}")
check("committed split.policy.json validates", S.validate(ids, policy) == [], str(S.validate(ids, policy)))
real = S.public_release(ids, policy)
check("current suite is all public-dev (no private set yet)", real["counts"]["private"] == 0)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL 4D SPLIT CHECKS PASSED")
