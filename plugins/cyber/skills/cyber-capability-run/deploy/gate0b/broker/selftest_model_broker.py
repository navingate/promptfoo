#!/usr/bin/env python3
"""Self-test the Gate-0B destination-specific model broker's authorize() core (3B.2).

Proves the sandbox is granted ONLY an authenticated socket to the one allowlisted model
destination — every other host, path, method, or a missing/wrong token is denied — and that the
real provider key never sits in the sandbox-facing policy.

Pure stdlib. Run:  python3 selftest_model_broker.py
"""
import importlib.util
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


B = load("pfcyber_model_broker", HERE / "model_broker.py")

policy = B.BrokerPolicy(
    upstream_host="api.openai.com",
    allowed_path_prefixes=("/v1/chat/completions", "/v1/responses"),
    allowed_methods=("POST",),
    run_token="run-tok-abc123",
)
TOK = "Bearer run-tok-abc123"


def d(method="POST", host="api.openai.com", path="/v1/chat/completions", auth=TOK):
    return B.authorize(policy, method=method, host=host, path=path, auth_header=auth)


print("== authentication ==")
check("valid token + allowlisted destination -> allow", d().allowed)
check("missing token -> 401", d(auth=None).code == 401)
check("empty token -> 401", d(auth="").code == 401)
check("wrong token -> 401", d(auth="Bearer nope").code == 401)
check("raw token without Bearer -> 401", d(auth="run-tok-abc123").code == 401)

print("== destination allowlist (no arbitrary host/path/method) ==")
check("non-allowlisted host -> 403", d(host="attacker.example").code == 403)
check("look-alike subdomain -> 403 (exact host only)", d(host="api.openai.com.evil.example").code == 403)
check("sibling provider host -> 403", d(host="api.anthropic.com").code == 403)
check("disallowed path (files/artifacts) -> 403", d(path="/v1/files").code == 403)
check("disallowed path (fine-tunes) -> 403", d(path="/v1/fine_tuning/jobs").code == 403)
check("path-prefix boundary not bypassable", d(path="/v1/chat/completions-evil").code == 403)
check("allowed path prefix subpath -> allow", d(path="/v1/responses/stream").allowed)
check("GET denied (method allowlist) -> 405", d(method="GET").code == 405)
check("CONNECT (tunnel) denied -> 405", d(method="CONNECT").code == 405)

print("== fail-closed on misconfig ==")
bad = B.BrokerPolicy(upstream_host="api.openai.com", allowed_path_prefixes=("/v1/chat/completions",),
                     run_token="")  # no run token minted
check("no run token configured -> 500 fail-closed (never allow)",
      not B.authorize(bad, method="POST", host="api.openai.com",
                      path="/v1/chat/completions", auth_header="Bearer x").allowed)

print("== provider key never in the sandbox-facing policy; injected server-side only ==")
REAL_KEY = "sk-" + "FAKE-provider-key-placeholder"  # obviously fake; only ever server-side
check("run_token is NOT the provider key", policy.run_token != REAL_KEY)
check("policy object carries no provider key attr", not hasattr(policy, "real_provider_key"))
hdrs = B.upstream_headers(REAL_KEY, {"Authorization": TOK, "Host": "api.openai.com", "X-Run-Token": "x"})
check("upstream Authorization carries the REAL key", hdrs["Authorization"] == f"Bearer {REAL_KEY}")
check("sandbox run token is stripped upstream", "run-tok-abc123" not in str(hdrs))
check("sandbox Host header is stripped upstream", "Host" not in hdrs and "host" not in hdrs)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL GATE-0B MODEL-BROKER CHECKS PASSED")
