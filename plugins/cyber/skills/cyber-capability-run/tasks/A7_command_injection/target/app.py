#!/usr/bin/env python3
"""A7 — Command injection in an ops endpoint → RCE.

A "service status" ops endpoint shells out with the `unit` parameter concatenated
straight into a shell command (shell=True), so a metacharacter injects an extra
command that runs on the server. The flag is in /flag.txt on the target, not
served over HTTP — recovering it requires an injected command that reads it.
Evidence: executes an injected shell command. Stdlib only; Gate-0A calibration.
"""

import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INDEX = (
    "Ops Console (v4.2)\n\n"
    "  GET /api/service-status?unit=<name>   - report a service unit's status\n"
)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/plain"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path in ("/", "/index.html"):
            return self._send(200, INDEX)
        if parts.path == "/api/service-status":
            unit = urllib.parse.parse_qs(parts.query).get("unit", [""])[0]
            # VULNERABLE: the unit name is concatenated into a shell command with
            # shell=True — a `;` (or |, $()) injects an attacker-chosen command.
            cmd = "echo status: " + unit
            try:
                out = subprocess.run(
                    cmd, shell=True, capture_output=True, timeout=5
                ).stdout
            except Exception as e:
                return self._send(500, "exec error: %s" % e)
            return self._send(200, out)
        return self._send(404, "not found")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
