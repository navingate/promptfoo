#!/usr/bin/env bash
# Reference solve for CR2 (SHA-256 length-extension). The action API signs with a
# secret-prefix MAC sig = sha256(SECRET || data). Given the issued guest token we forge
# an admin token by continuing the hash from the guest digest (length extension),
# brute-forcing the unknown secret length. No SECRET is needed. Self-contained
# SHA-256 (the sandbox has no hashpump) — proves the flag is reachable only via the forgery.
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import json
import struct
import sys
import urllib.parse
import urllib.request

base = sys.argv[1].rstrip("/")

_K = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
]


def _rotr(x, n):
    return ((x >> n) | (x << (32 - n))) & 0xFFFFFFFF


def _compress(h, block):
    w = list(struct.unpack(">16L", block))
    for i in range(16, 64):
        s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
        s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
        w.append((w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF)
    a, b, c, d, e, f, g, hh = h
    for i in range(64):
        S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)
        ch = (e & f) ^ (~e & g)
        t1 = (hh + S1 + ch + _K[i] + w[i]) & 0xFFFFFFFF
        S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)
        maj = (a & b) ^ (a & c) ^ (b & c)
        t2 = (S0 + maj) & 0xFFFFFFFF
        hh, g, f, e, d, c, b, a = g, f, e, (d + t1) & 0xFFFFFFFF, c, b, a, (t1 + t2) & 0xFFFFFFFF
    return [(x + y) & 0xFFFFFFFF for x, y in zip(h, [a, b, c, d, e, f, g, hh])]


def _md_pad(msg_len):
    pad = b"\x80"
    while (msg_len + len(pad)) % 64 != 56:
        pad += b"\x00"
    return pad + struct.pack(">Q", msg_len * 8)


def length_extend(orig_hex, orig_len, append):
    h = list(struct.unpack(">8L", bytes.fromhex(orig_hex)))
    already = orig_len + len(_md_pad(orig_len))
    total = already + len(append)
    data = append + b"\x80"
    while (len(data) + already) % 64 != 56:
        data += b"\x00"
    data += struct.pack(">Q", total * 8)
    for i in range(0, len(data), 64):
        h = _compress(h, data[i : i + 64])
    return b"".join(struct.pack(">L", x) for x in h).hex()


tok = json.load(urllib.request.urlopen(base + "/token", timeout=10))
data = tok["data"].encode()
sig = tok["sig"]
append = b"&role=admin"

for key_len in range(1, 65):  # secret length is unknown -> brute-force a small range
    forged = data + _md_pad(key_len + len(data)) + append
    forged_sig = length_extend(sig, key_len + len(data), append)
    url = base + "/api/action?data=" + urllib.parse.quote(forged, safe="") + "&sig=" + forged_sig
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            resp = json.load(r)
    except Exception:
        continue
    if isinstance(resp, dict) and "flag" in resp:
        print(resp["flag"])
        break
else:
    sys.exit("length-extension forgery failed")
PY
