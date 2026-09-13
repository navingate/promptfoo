#!/usr/bin/env python3
"""Gate-0B authenticated, destination-specific model broker (3B.2).

The agent/solver inside a per-sample sandbox needs to reach the model API to run — but it must
NOT get a generic outbound socket it could use to reach an arbitrary provider, host, or artifact
store (exfiltration, unintended tool use, or fetching a public walkthrough to cheat). This broker
is the ONLY egress the agent context is granted, and it is destination-specific:

  - AUTH: every request must present the per-run bearer token. The token is minted per run and is
    NOT the real provider key — the sandbox never holds the provider credential.
  - DESTINATION ALLOWLIST: only the ONE configured model host is reachable, and only the specific
    inference path prefixes (e.g. /v1/chat/completions). Any other host/path/method is denied.
  - CREDENTIAL INJECTION: the broker adds the real provider key server-side, so it never crosses
    the sandbox boundary.

`authorize()` is a PURE decision (fully self-tested); the HTTP forwarder around it is a host
skeleton (real upstream I/O runs on the Gate-0B host). See references/isolation-and-broker.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class BrokerPolicy:
    """The sandbox-facing policy. Note it carries the per-run token, NOT the provider key."""
    upstream_host: str                      # the ONE allowed model host, e.g. "api.openai.com"
    allowed_path_prefixes: tuple = ()       # e.g. ("/v1/chat/completions", "/v1/responses")
    allowed_methods: tuple = ("POST",)
    run_token: str = ""                     # per-run bearer the sandbox must present


@dataclass(frozen=True)
class Decision:
    allowed: bool
    code: int
    reason: str


def authorize(policy: BrokerPolicy, *, method: str, host: str, path: str,
              auth_header: str | None) -> Decision:
    """Allow ONLY an authenticated request to the one allowlisted model destination.

    Order matters: authenticate first (a bad token never learns whether a host is allowed), then
    enforce the destination allowlist (host, then path), then the method.
    """
    if not policy.run_token:
        return Decision(False, 500, "broker_misconfigured_no_run_token")  # fail closed
    if auth_header != f"Bearer {policy.run_token}":
        return Decision(False, 401, "bad_or_missing_run_token")
    # destination-specific: exact host match only (no subdomain wildcarding, no arbitrary host)
    if host != policy.upstream_host:
        return Decision(False, 403, f"host_not_allowed:{host}")
    if not any(path == p or path.startswith(p.rstrip("/") + "/") or path == p.rstrip("/")
               for p in policy.allowed_path_prefixes):
        return Decision(False, 403, f"path_not_allowed:{path}")
    if method.upper() not in tuple(m.upper() for m in policy.allowed_methods):
        return Decision(False, 405, f"method_not_allowed:{method}")
    return Decision(True, 200, "ok")


def upstream_headers(real_provider_key: str, incoming: dict | None = None) -> dict:
    """Headers to send UPSTREAM: strip the sandbox's run token, inject the real provider key.

    The real key exists only here (broker/host side); the sandbox's Authorization (its run token)
    is never forwarded to the provider.
    """
    headers = {k: v for k, v in (incoming or {}).items()
               if k.lower() not in ("authorization", "host", "x-run-token")}
    headers["Authorization"] = f"Bearer {real_provider_key}"
    return headers


# --- host skeleton (real forwarding runs on the Gate-0B host) --------------------------------
@dataclass
class BrokerConfig:
    policy: BrokerPolicy
    real_provider_key: str = field(repr=False, default="")  # server-side only; never logged
    bind: str = "127.0.0.1"
    port: int = 8900


def _make_handler(cfg: BrokerConfig):  # pragma: no cover - exercised on the host
    import urllib.request
    from http.server import BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def _deny(self, d: Decision):
            self.send_response(d.code)
            self.end_headers()
            self.wfile.write(d.reason.encode())

        def do_POST(self):
            host = self.headers.get("X-Upstream-Host", cfg.policy.upstream_host)
            d = authorize(cfg.policy, method="POST", host=host, path=self.path,
                          auth_header=self.headers.get("Authorization"))
            if not d.allowed:
                return self._deny(d)
            body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
            req = urllib.request.Request(
                f"https://{cfg.policy.upstream_host}{self.path}", data=body,
                headers=upstream_headers(cfg.real_provider_key, dict(self.headers)), method="POST")
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
                self.send_response(r.status)
                self.end_headers()
                self.wfile.write(data)

        def log_message(self, *a):
            pass

    return Handler
