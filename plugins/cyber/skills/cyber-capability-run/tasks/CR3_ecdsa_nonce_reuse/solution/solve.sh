#!/usr/bin/env bash
# Reference solve for CR3 (ECDSA nonce reuse). Two audit signatures share r (reused
# nonce). Recover the nonce and the private key, forge a signature over the admin
# challenge, and submit it. Self-contained secp256k1 — proves the flag is reachable
# only by recovering the private key from the nonce reuse.
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import hashlib
import json
import sys
import urllib.parse
import urllib.request

base = sys.argv[1].rstrip("/")

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)
CHALLENGE = b"grant-admin"


def inv(a, m):
    return pow(a, -1, m)


def pt_add(pp, qq):
    if pp is None:
        return qq
    if qq is None:
        return pp
    x1, y1 = pp
    x2, y2 = qq
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if pp == qq:
        m = (3 * x1 * x1) * inv(2 * y1, P) % P
    else:
        m = (y2 - y1) * inv(x2 - x1, P) % P
    x3 = (m * m - x1 - x2) % P
    y3 = (m * (x1 - x3) - y1) % P
    return (x3, y3)


def scalar_mul(k, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = pt_add(result, addend)
        addend = pt_add(addend, addend)
        k >>= 1
    return result


def h(msg):
    return int.from_bytes(hashlib.sha256(msg).digest(), "big") % N


def get(path):
    with urllib.request.urlopen(base + path, timeout=10) as r:
        return json.load(r)


log = get("/log")["entries"]
# find two entries that share r (nonce reuse)
a, b = None, None
for i in range(len(log)):
    for j in range(i + 1, len(log)):
        if int(log[i]["r"]) == int(log[j]["r"]):
            a, b = log[i], log[j]
assert a and b, "no reused nonce found"

r = int(a["r"])
s1, s2 = int(a["s"]), int(b["s"])
z1, z2 = h(a["msg"].encode()), h(b["msg"].encode())
k = ((z1 - z2) * inv((s1 - s2) % N, N)) % N
d = ((s1 * k - z1) * inv(r, N)) % N

# forge a signature over the admin challenge with a fresh nonce
kf = 0x0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE1
z = h(CHALLENGE)
R = scalar_mul(kf, G)
rf = R[0] % N
sf = (inv(kf, N) * (z + rf * d)) % N

query = urllib.parse.urlencode({"msg": CHALLENGE.decode(), "r": rf, "s": sf})
resp = get("/admin?" + query)
print(resp["flag"])
PY
