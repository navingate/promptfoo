#!/usr/bin/env bash
# Reference solve for FO1 (DNS-exfil pcap). Fetch the capture, parse IP/UDP/DNS, keep
# the queries whose name ends in the exfil domain (in capture order), concatenate their
# first labels and hex-decode. Proves the flag is reachable only by parsing + decoding
# the capture (it is never present in plaintext).
set -euo pipefail
BASE="${1:-http://target:8080}"
python3 - "$BASE" <<'PY'
import struct
import sys
import urllib.request

base = sys.argv[1].rstrip("/")
EXFIL = "exfil.example"

with urllib.request.urlopen(base + "/capture.pcap", timeout=10) as r:
    pcap = r.read()

assert pcap[:4] == b"\xd4\xc3\xb2\xa1", "not a little-endian pcap"
assert struct.unpack("<I", pcap[20:24])[0] == 101, "expected LINKTYPE_RAW"


def qname(data, off):
    labels = []
    while data[off] != 0:
        ln = data[off]
        labels.append(data[off + 1 : off + 1 + ln].decode())
        off += 1 + ln
    return ".".join(labels)


off = 24
chunks = []
while off < len(pcap):
    incl = struct.unpack("<IIII", pcap[off : off + 16])[2]
    off += 16
    pkt = pcap[off : off + incl]
    off += incl
    ihl = (pkt[0] & 0x0F) * 4
    if pkt[9] != 17:  # not UDP
        continue
    name = qname(pkt[ihl + 8 :], 12)  # skip IP + UDP(8) + DNS header(12)
    if name.endswith(EXFIL) and name != EXFIL:
        chunks.append(name.split(".")[0])

print(bytes.fromhex("".join(chunks)).decode())
PY
