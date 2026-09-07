#!/usr/bin/env python3
"""Regression for provider.py's named SUT-endpoint registry (SUT_ENDPOINTS / `sut_endpoint`).

Lets ANY task config pick a target-model endpoint via `sut_endpoint:` (or CYBER_SUT_ENDPOINT env)
instead of duplicating a whole config file per endpoint. Critical property: the default ("local",
or the key simply absent) must be BYTE-IDENTICAL to provider.py's behavior before this feature
existed, because every existing config (F1, F2, scenarios, authored, ...) relies on that default —
a regression here silently breaks every other task, not just the new "azure"/"chutes" presets.
Also proves the presets stay isolated from each other (picking one never leaks another's base_url).

Drives the REAL call_api(), not a reimplementation of its logic: caisi_dir is faked (an empty temp
dir, just enough to pass the `caisi_dir.is_dir()` gate) and subprocess.run is monkeypatched to
record the `env` kwarg it would have launched `inspect` with, then raise FileNotFoundError so
call_api returns its normal "`inspect` not found" error — proving the resolution ran on the REAL
code path without needing a real CAISI install. Pure stdlib.

Run:  python3 selftest_sut_endpoints.py
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent.parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


P = _load("pfprov_sut", SKILL / "scripts" / "provider.py")

fails = []


def check(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else f"  {extra}"))
    if not cond:
        fails.append(name)


def call_with(config, env_overrides=None):
    """Call the REAL call_api() with a fake caisi_dir; capture the env subprocess.run would see."""
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        raise FileNotFoundError("inspect not installed in this test sandbox")

    with tempfile.TemporaryDirectory() as fake_caisi:
        cfg = {**config, "caisi_dir": fake_caisi}
        options = {"config": cfg}
        old_env = dict(os.environ)
        try:
            for k, v in (env_overrides or {}).items():
                os.environ[k] = v
            with mock.patch.object(subprocess, "run", side_effect=fake_run):
                result = P.call_api("", options, {"vars": {"task": "pfcyber-f1-adtakeover"}})
        finally:
            os.environ.clear()
            os.environ.update(old_env)
    return result, captured.get("env")


BASE_CFG = {"benchmark": "authored", "model": "openai/x"}

print("== 1. default (no sut_endpoint key) — byte-identical to pre-feature behavior ==")
result, env = call_with(BASE_CFG)
check("call_api reached the subprocess stage (no sut_endpoint error)",
      result.get("error", "").startswith("`inspect` not found"), result)
check("OPENAI_BASE_URL NOT injected (defers to CAISI's own .env, as before)",
      env is not None and "OPENAI_BASE_URL" not in env or (env or {}).get("OPENAI_BASE_URL") ==
      os.environ.get("OPENAI_BASE_URL"))

print("== 2. explicit sut_endpoint: local — same no-op as the default ==")
result, env = call_with({**BASE_CFG, "sut_endpoint": "local"})
check("no OPENAI_BASE_URL override for 'local'",
      (env or {}).get("OPENAI_BASE_URL") == os.environ.get("OPENAI_BASE_URL"))

print("== 3. sut_endpoint: azure — resolves the halo-dataline Azure preset ==")
result, env = call_with({**BASE_CFG, "sut_endpoint": "azure"}, env_overrides={"HALO_AZURE_AI_API_KEY": "test-key-123"})
check("BASE_URL resolved to the azure preset",
      (env or {}).get("OPENAI_BASE_URL") == "https://halo-dataline-resource.services.ai.azure.com/openai/v1",
      env.get("OPENAI_BASE_URL") if env else None)
check("API_KEY pulled from HALO_AZURE_AI_API_KEY", (env or {}).get("OPENAI_API_KEY") == "test-key-123")

print("== 4. sut_endpoint: azure, but key not set in env — no crash, just no key injected ==")
os.environ.pop("HALO_AZURE_AI_API_KEY", None)
result, env = call_with({**BASE_CFG, "sut_endpoint": "azure"})
check("base_url still resolved even without the key present",
      (env or {}).get("OPENAI_BASE_URL") == "https://halo-dataline-resource.services.ai.azure.com/openai/v1")
check("no OPENAI_API_KEY injected when the source env var is absent",
      "OPENAI_API_KEY" not in (env or {}) or (env or {}).get("OPENAI_API_KEY") == os.environ.get("OPENAI_API_KEY"))

print("== 3b. sut_endpoint: chutes — resolves the Chutes gateway preset ==")
result, env = call_with({**BASE_CFG, "sut_endpoint": "chutes"}, env_overrides={"CHUTES_API_KEY": "chutes-key-456"})
check("BASE_URL resolved to the chutes preset",
      (env or {}).get("OPENAI_BASE_URL") == "https://llm.chutes.ai/v1",
      env.get("OPENAI_BASE_URL") if env else None)
check("API_KEY pulled from CHUTES_API_KEY", (env or {}).get("OPENAI_API_KEY") == "chutes-key-456")
check("chutes and azure presets don't leak into each other (different base_url)",
      (env or {}).get("OPENAI_BASE_URL") != "https://halo-dataline-resource.services.ai.azure.com/openai/v1")

print("== 5. unknown sut_endpoint — clean error, never reaches the subprocess ==")
result, env = call_with({**BASE_CFG, "sut_endpoint": "not-a-real-endpoint"})
check("clean error naming the bad value", "unknown sut_endpoint" in result.get("error", ""), result)
check("lists all three valid choices", all(c in result.get("error", "") for c in ("azure", "chutes", "local")),
      result)
check("never reached the subprocess stage", env is None)

print("== 6. explicit config base_url/api_key_env still OVERRIDES the registry (one-off escape hatch) ==")
result, env = call_with({
    **BASE_CFG, "sut_endpoint": "azure",
    "base_url": "http://totally-different-endpoint:9999/v1",
    "api_key_env": "SOME_OTHER_KEY",
}, env_overrides={"SOME_OTHER_KEY": "override-key"})
check("explicit base_url wins over the azure preset",
      (env or {}).get("OPENAI_BASE_URL") == "http://totally-different-endpoint:9999/v1")
check("explicit api_key_env wins over the azure preset", (env or {}).get("OPENAI_API_KEY") == "override-key")

print("== 7. sut_endpoint case-insensitive + whitespace-tolerant (env vars are easy to fat-finger) ==")
result, env = call_with({**BASE_CFG, "sut_endpoint": "  Azure  "}, env_overrides={"HALO_AZURE_AI_API_KEY": "k"})
check("'  Azure  ' normalizes to the azure preset",
      (env or {}).get("OPENAI_BASE_URL") == "https://halo-dataline-resource.services.ai.azure.com/openai/v1")

print()
if fails:
    print(f"*** {len(fails)} FAILED: {fails}")
    sys.exit(1)
print("ALL SUT-ENDPOINT REGISTRY CHECKS PASSED")
