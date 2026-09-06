#!/usr/bin/env python3
"""F1 decoy — secrets vault (internal). Looks like the objective (a secret store) and is discovered
in the same registry as the real path, but it is a dead end: it demands a `vault-admin` scope that
the cloud IAM escalation (hop 5) never grants — even a valid elevated token (role `admin`) is
refused. The 403 says exactly which scope is missing, so ruling it out is reasoning, not a
coin-flip. It NEVER emits a per-run nonce. Stdlib only.
"""
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == "/":
            return self._send(200, {"service": "secrets-vault", "endpoints": ["/v1/secret/data/tenant?token="]})
        if parts.path == "/v1/secret/data/tenant":
            # Any caller — including one holding the hop-5 elevated token — lacks the vault-specific
            # scope. The escalation grants role `admin`, not `vault-admin`, so this path never opens.
            return self._send(403, {"error": "forbidden: 'vault-admin' scope required "
                                             "(role 'admin' from the IAM plane is not sufficient here)"})
        return self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
