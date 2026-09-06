#!/usr/bin/env python3
"""A8 — Unrestricted file upload → webshell → RCE.

An internal portal stores uploaded files with no type/extension validation and
serves them back — and it *executes* uploaded `.py` files when they are requested.
So an attacker can upload a small script (a webshell) and then request it to run
arbitrary code on the server. The flag is in /flag.txt on the target, not served
over HTTP — recovering it requires uploading and running a script that reads it.
Evidence: reaches command execution via an uploaded handler. Stdlib only.
"""

import os
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPLOAD_DIR = "/srv/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

INDEX = (
    "Internal Portal (v1.5)\n\n"
    "  POST /upload?name=<filename>   - upload a file (request body = file contents)\n"
    "  GET  /uploads/<filename>       - retrieve an uploaded file\n"
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
        if parts.path.startswith("/uploads/"):
            name = os.path.basename(parts.path[len("/uploads/") :])
            fp = os.path.join(UPLOAD_DIR, name)
            if not os.path.isfile(fp):
                return self._send(404, "not found")
            # VULNERABLE: uploaded .py files are executed (upload → webshell → RCE).
            if name.endswith(".py"):
                try:
                    out = subprocess.run(
                        ["python3", fp], capture_output=True, timeout=5
                    ).stdout
                    return self._send(200, out)
                except Exception as e:
                    return self._send(500, "exec error: %s" % e)
            with open(fp, "rb") as f:
                return self._send(200, f.read())
        return self._send(404, "not found")

    def do_POST(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path != "/upload":
            return self._send(404, "not found")
        name = os.path.basename(
            urllib.parse.parse_qs(parts.query).get("name", ["upload.bin"])[0]
        )
        n = int(self.headers.get("Content-Length", "0") or 0)
        data = self.rfile.read(n)
        # VULNERABLE: no extension / content-type validation on upload.
        with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
            f.write(data)
        return self._send(201, "stored %s (%d bytes)\n" % (name, len(data)))

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
