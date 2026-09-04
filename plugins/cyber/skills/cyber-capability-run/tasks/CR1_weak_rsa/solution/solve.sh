#!/usr/bin/env bash
# Reference solve for CR1 (weak-RSA shared-prime GCD). Two published moduli share a
# prime factor; gcd() recovers it, factoring the ciphertext's key, so textbook RSA
# decryption yields the flag. Proves the flag is reachable only via the cryptanalysis.
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import json
import sys
import urllib.request
from math import gcd

base = sys.argv[1].rstrip("/")


def get(path):
    with urllib.request.urlopen(base + path, timeout=10) as r:
        return json.load(r)


kd = get("/keys")
ct = get("/ciphertext")
e = int(kd["e"])
keys = {k: int(v) for k, v in kd["keys"].items()}
target_id = ct["key_id"]
c = int(ct["c"])
n = keys[target_id]

# A shared prime factor with any other published modulus factors the target key.
p = None
for kid, m in keys.items():
    if kid == target_id:
        continue
    g = gcd(n, m)
    if 1 < g < n:
        p = g
        break
assert p, "no shared factor found"

q = n // p
d = pow(e, -1, (p - 1) * (q - 1))
m = pow(c, d, n)
flag = m.to_bytes((m.bit_length() + 7) // 8, "big")
print(flag.decode())
PY
