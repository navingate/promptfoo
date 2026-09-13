#!/usr/bin/env python3
"""Promptfoo CHAT provider for the F2 federation CORRELATION defense task.

Same per-model interface as the OFFENSE side (CYBER_SUT_ENDPOINT + CYBER_MODEL, with the CYBER_<KEY> env
fallback every setting gets), so you run one model per command exactly like the offense calibration — but
this makes a plain OpenAI-compatible CHAT call (not the agentic solver): it sends the correlation brief
(the same build_prompt the task uses) and returns the model's rule text, which assert_correlation.py then
scores over the held-out GROUNDED corpus.

Endpoint resolution mirrors the offense provider: an explicit CYBER_BASE_URL / CYBER_API_KEY_ENV always
wins; otherwise CYBER_SUT_ENDPOINT is looked up in the OFFENSE provider's SUT_ENDPOINTS registry (reused at
runtime, so any endpoint you added there — e.g. `engy` — resolves identically here). Auth is
`Authorization: Bearer <key>` (works for Chutes and for Azure's OpenAI-compatible /openai/v1 endpoint).

Run one model per command (from the repo root), e.g.:
  CYBER_SUT_ENDPOINT=azure CYBER_MODEL=openai/DeepSeek-V4-Flash \
    npm run local -- eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.correlation.yaml \
      --no-cache --repeat 10 --max-concurrency 2 -o /tmp/f2def_deepseek.json

Referenced as: providers: - id: file://correlation_provider.py
"""

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
if str(_SKILL) not in sys.path:
    sys.path.insert(0, str(_SKILL))
# the offense provider (stdlib-only module) owns the shared endpoint registry; reuse it at runtime.
_OFFENSE_PROVIDER = (_SKILL.parents[2] / "cyber" / "skills" / "cyber-capability-run" / "scripts"
                     / "provider.py")
# built-in fallback if the offense module can't be located (keeps azure/chutes working standalone).
_FALLBACK_ENDPOINTS = {
    "local": {},
    "azure": {"base_url": "https://halo-dataline-resource.services.ai.azure.com/openai/v1",
              "api_key_env": "HALO_AZURE_AI_API_KEY"},
    "chutes": {"base_url": "https://llm.chutes.ai/v1", "api_key_env": "CHUTES_API_KEY"},
}


def _sut_endpoints() -> dict:
    try:
        spec = importlib.util.spec_from_file_location("_offense_provider", _OFFENSE_PROVIDER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        reg = dict(getattr(mod, "SUT_ENDPOINTS", {}) or {})
        return reg or dict(_FALLBACK_ENDPOINTS)
    except Exception:  # noqa: BLE001 - degrade to the built-in registry; explicit overrides still work
        return dict(_FALLBACK_ENDPOINTS)


def _cfg(options, key, default=None):
    """provider config, then env (CYBER_<KEY>), then default — same precedence as the offense provider."""
    cfg = (options or {}).get("config", {}) or {}
    if cfg.get(key) is not None:
        return cfg[key]
    env = os.environ.get("CYBER_" + key.upper())
    return env if env not in (None, "") else default


def _api_model(model: str) -> str:
    """CYBER_MODEL uses the inspect-style provider selector `openai/<deployment>` (e.g.
    openai/DeepSeek-V4-Flash, openai/glm-5.3). The OpenAI-compatible API wants just the deployment/model
    name — inspect strips the `openai/` selector the same way; leaving it on makes Azure/Chutes 404 with
    DeploymentNotFound. Strip a single leading `openai/` and pass the rest through unchanged."""
    return model[len("openai/"):] if model.startswith("openai/") else model


def call_api(prompt=None, options=None, context=None):
    from prompts.correlation_prompt import build_prompt

    endpoint = _cfg(options, "sut_endpoint", "chutes")
    model = _cfg(options, "model", "openai/DeepSeek-V4-Flash")

    base_url = _cfg(options, "base_url")
    api_key_env = _cfg(options, "api_key_env")
    if not base_url or not api_key_env:  # fall back to the endpoint registry (offense-shared)
        preset = _sut_endpoints().get(endpoint, {})
        base_url = base_url or preset.get("base_url")
        api_key_env = api_key_env or preset.get("api_key_env")
    if not base_url or not api_key_env:
        return {"error": f"endpoint {endpoint!r}: set CYBER_SUT_ENDPOINT to a known endpoint "
                         "(azure/chutes/…) or provide CYBER_BASE_URL + CYBER_API_KEY_ENV"}
    api_key = os.environ.get(api_key_env, "")
    if not api_key:
        return {"error": f"API key env {api_key_env!r} is empty for endpoint {endpoint!r}"}

    api_model = _api_model(model)
    payload = {
        "model": api_model,
        "messages": build_prompt(),
        "temperature": float(_cfg(options, "temperature", 0.7)),
        "max_tokens": int(_cfg(options, "max_tokens", 4000)),
    }
    # reasoning_effort (config.reasoning_effort or CYBER_REASONING_EFFORT; e.g. "low"/"minimal"/"none"): sent
    # ONLY when set, so non-reasoning endpoints are unaffected. Reasoning models (GLM-5.2/5.3) otherwise fill
    # the entire max_tokens budget with reasoning and emit no rule (finish_reason=length, empty content) — a
    # bounded effort makes them converge to the rule. See engy.ai/docs#reasoning-effort.
    effort = _cfg(options, "reasoning_effort")
    if effort:
        payload["reasoning_effort"] = effort
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            data = json.loads(r.read())
        choice = data["choices"][0]
        content = (choice.get("message", {}) or {}).get("content") or ""
        # Reasoning models (e.g. GLM-5.2/5.3) put their chain-of-thought in a separate `reasoning_content`
        # field and only then emit the rule in `content`. If the token budget is exhausted mid-reasoning the
        # API returns finish_reason=length with EMPTY content — surface that as a clear error instead of an
        # opaque "rule did not parse", so a too-small max_tokens is obvious. (The fix is headroom, set in the
        # config; the rule must come from `content`, never the reasoning text.)
        if not content.strip():
            fr = choice.get("finish_reason")
            hint = " — raise max_tokens (reasoning consumed the budget)" if fr == "length" else ""
            return {"error": f"model returned empty content (finish_reason={fr}){hint}"}
        return {"output": content}
    except urllib.error.HTTPError as e:  # surface the endpoint's own error (e.g. an unknown model id 404)
        detail = e.read()[:400].decode(errors="replace")
        return {"error": f"{e.code} {e.reason} from {endpoint}/{api_model}: {detail}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}
