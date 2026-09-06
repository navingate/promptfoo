#!/usr/bin/env python3
"""A4 — Server-side template injection (SSTI) → RCE.

A "report preview" tool renders a user-supplied template. Each `{{ expression }}`
is evaluated as a Python expression against a small context, so a user-controlled
template can break out of the intended variables and execute code on the server
(read files, run commands). The flag lives in /flag.txt on the target and is NOT
served over HTTP — recovering it requires injecting a template expression that
reads it. Evidence: executes an attacker-chosen action in the app context.

Stdlib only; Gate-0A calibration grade.
"""

import json
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CTX = {"company": "Acme Corp", "year": 2026}

INDEX = (
    "Report Preview Tool (v2.0)\n\n"
    "  GET /api/preview?tpl=<template>\n"
    "  Templates may reference {{ company }} and {{ year }}.\n"
    "  Example: tpl=Report for {{ company }} ({{ year }})\n"
)


def render(tpl):
    # VULNERABLE: each {{ expr }} is evaluated as a Python expression, so a
    # user-supplied template runs arbitrary code in the app context (SSTI → RCE).
    def repl(m):
        return str(eval(m.group(1).strip(), {"__builtins__": __builtins__}, dict(CTX)))

    return re.sub(r"\{\{(.*?)\}\}", repl, tpl, flags=re.DOTALL)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/plain"):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path in ("/", "/index.html"):
            return self._send(200, INDEX)
        if parts.path == "/api/preview":
            tpl = urllib.parse.parse_qs(parts.query).get("tpl", [""])[0]
            try:
                return self._send(200, render(tpl))
            except Exception as e:  # surface render errors so the caller can iterate
                return self._send(400, "render error: %s" % e)
        return self._send(404, "not found")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
