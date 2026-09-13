#!/usr/bin/env python3
"""Offline selftest for correlation_provider.py — the F2 correlation defense CHAT provider. Exercises the
pure endpoint-resolution + error paths (no network): the offense endpoint registry is reused, CYBER_<KEY>
env precedence works, and a missing endpoint / missing key surfaces a clear error BEFORE any HTTP call (so
a misconfigured run fails loud, not silent). The live chat call itself is user-run. Run:
`python3 selftest_correlation_provider.py`.
"""

import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location("correlation_provider", HERE / "correlation_provider.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    print("[selftest_correlation_provider]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    for k in ("CYBER_MODEL", "CYBER_SUT_ENDPOINT", "CYBER_BASE_URL", "CYBER_API_KEY_ENV"):
        os.environ.pop(k, None)
    cp = _load()

    reg = cp._sut_endpoints()
    check("azure" in reg and "chutes" in reg,
          f"reuses the offense endpoint registry (azure/chutes present): {sorted(reg)}")

    check(cp._api_model("openai/DeepSeek-V4-Flash") == "DeepSeek-V4-Flash"
          and cp._api_model("openai/glm-5.3") == "glm-5.3" and cp._api_model("glm-5.3") == "glm-5.3",
          "the inspect-style 'openai/' provider prefix is stripped before the API call (DeploymentNotFound fix)")

    os.environ["CYBER_MODEL"] = "openai/glm-5.3"
    os.environ["CYBER_SUT_ENDPOINT"] = "engy"
    check(cp._cfg(None, "model", "d") == "openai/glm-5.3" and cp._cfg(None, "sut_endpoint", "chutes") == "engy",
          "CYBER_<KEY> env precedence resolves model + endpoint")
    check(cp._cfg({"config": {"model": "x"}}, "model", "d") == "x",
          "explicit provider config overrides env")

    # unknown endpoint + no explicit base_url/key -> clear error, no network
    os.environ["CYBER_SUT_ENDPOINT"] = "does-not-exist"
    r = cp.call_api(None, {"config": {}}, None)
    check("error" in r and "does-not-exist" in r["error"],
          "unknown endpoint with no override -> clear error (no HTTP)")

    # known endpoint but empty key -> error names the key env (proves base_url resolved + brief built first)
    os.environ["CYBER_SUT_ENDPOINT"] = "chutes"
    os.environ["CHUTES_API_KEY"] = ""
    r = cp.call_api(None, {"config": {}}, None)
    check("error" in r and "CHUTES_API_KEY" in r["error"], "empty API key -> error names the key env (no HTTP)")

    # explicit CYBER_BASE_URL + CYBER_API_KEY_ENV override the registry (offense parity)
    os.environ["CYBER_SUT_ENDPOINT"] = "brand-new"
    os.environ["CYBER_BASE_URL"] = "https://example.internal/v1"
    os.environ["CYBER_API_KEY_ENV"] = "MY_KEY"
    os.environ.pop("MY_KEY", None)
    r = cp.call_api(None, {"config": {}}, None)
    check("error" in r and "MY_KEY" in r["error"],
          "explicit CYBER_BASE_URL/CYBER_API_KEY_ENV override an unknown endpoint (resolves, then key error)")

    print("[selftest_correlation_provider]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
