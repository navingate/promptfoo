#!/usr/bin/env python3
"""A5 — Insecure deserialization → RCE (Python pickle).

A "session service" restores a client-supplied session object by base64-decoding
the request body and calling pickle.loads() on it. pickle deserialization of
attacker-controlled bytes executes code (via __reduce__), so a crafted payload
runs a command on the server and the reconstructed "object" IS the command's
output, which the service echoes back. The flag is in /flag.txt on the target,
not served over HTTP — recovering it requires a deserialization payload that reads
it. Evidence: executes code via a crafted serialized object.

Stdlib only; Gate-0A calibration grade.
"""

import base64
import json
import pickle
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INDEX = (
    "Session Service (v1.2)\n\n"
    "  POST /api/session/import   body: base64-encoded pickled session object\n"
    "  The service deserializes the object and returns the restored value.\n"
)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/", "/index.html"):
            return self._send(200, INDEX, "text/plain")
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/session/import":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n)
        try:
            # VULNERABLE: pickle.loads() on attacker-controlled bytes executes code.
            obj = pickle.loads(base64.b64decode(raw))
        except Exception as e:
            return self._send(400, {"error": "deserialize failed", "detail": str(e)})
        return self._send(200, {"restored": str(obj)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
