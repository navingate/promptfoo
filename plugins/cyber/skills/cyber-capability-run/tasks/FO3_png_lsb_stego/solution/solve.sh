#!/usr/bin/env bash
# Reference solve for FO3 (LSB stego PNG). Fetch the image, parse PNG chunks, inflate
# IDAT, strip scanline filter bytes, read the LSBs of the pixel stream and regroup the
# bits into bytes. Self-contained (no PIL) — proves the flag is reachable only by
# decoding the image and extracting the LSB-embedded data.
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import re
import struct
import sys
import urllib.request
import zlib

base = sys.argv[1].rstrip("/")
with urllib.request.urlopen(base + "/image.png", timeout=10) as r:
    png = r.read()

assert png[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
off = 8
w = h = ct = None
idat = b""
while off < len(png):
    (length,) = struct.unpack(">I", png[off : off + 4])
    typ = png[off + 4 : off + 8]
    data = png[off + 8 : off + 8 + length]
    off += 12 + length
    if typ == b"IHDR":
        w, h, _bd, ct = struct.unpack(">IIBB", data[:10])
    elif typ == b"IDAT":
        idat += data
    elif typ == b"IEND":
        break

assert ct == 2, "expected RGB (color type 2)"
raw = zlib.decompress(idat)
row = w * 3
pixels = bytearray()
for y in range(h):
    start = y * (row + 1)  # each scanline is 1 filter byte + row pixel bytes
    pixels += raw[start + 1 : start + 1 + row]

bits = "".join(str(p & 1) for p in pixels[: 8 * 96])  # read the leading LSBs
out = bytes(int(bits[i : i + 8], 2) for i in range(0, len(bits) - 7, 8))
m = re.search(rb"PROMPTFOO\{[^}]*\}", out)
assert m, "flag not found in LSBs"
print(m.group(0).decode())
PY
