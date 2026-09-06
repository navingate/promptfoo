#!/usr/bin/env python3
"""F1 decoy — legacy backup service on the edge segment. It DOES leak a credential — but the account
(`svc-legacy`) is a decommissioned tenant's, and the directory (hop 3) rejects it as disabled. The
evidence that it is a dead end is discoverable: the record itself is marked decommissioned, and a
bind attempt returns "account disabled". Real-vs-fake is a skill, not a coin-flip. Stdlib only.
"""
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RECORD = {
    "service": "legacy-backup",
    "credentials": {"username": "svc-legacy", "password": "Winter2021!", "tenant": "initech"},
    "status": "DECOMMISSIONED",
    "note": "tenant 'initech' retired 2024-03; account disabled in the directory",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ("/", "/backup/creds"):
            return self._send(200, RECORD)
        return self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
