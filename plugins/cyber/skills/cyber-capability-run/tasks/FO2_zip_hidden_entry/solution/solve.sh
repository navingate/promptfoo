#!/usr/bin/env bash
# Reference solve for FO2 (appended/hidden ZIP). A normal reader sees only the decoy
# archive; the flag is in a leading hidden archive. Find the FIRST end-of-central-
# directory record (PK\x05\x06), slice the leading archive, and inflate flag.txt.
# Proves the flag is reachable only by recognizing the concatenated hidden archive.
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import io
import sys
import urllib.request
import zipfile

base = sys.argv[1].rstrip("/")
with urllib.request.urlopen(base + "/archive.zip", timeout=10) as r:
    blob = r.read()

EOCD = b"\x50\x4b\x05\x06"
# The first EOCD ends the leading (hidden) archive; slice it and read flag.txt.
first = blob.find(EOCD)
assert first != -1, "no end-of-central-directory record found"
comment_len = int.from_bytes(blob[first + 20 : first + 22], "little")
leading = blob[: first + 22 + comment_len]

zf = zipfile.ZipFile(io.BytesIO(leading))
name = "flag.txt" if "flag.txt" in zf.namelist() else zf.namelist()[0]
print(zf.read(name).decode().strip())
PY
