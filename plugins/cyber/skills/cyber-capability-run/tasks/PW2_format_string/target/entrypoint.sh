#!/bin/sh
# Gate-0B: per-run flag to /flag (ENV indirection keeps the flag's `{...}` out of the shell
# default word). Never baked into an image layer.
printf '%s\n' "${PFCYBER_NONCE_TERMINAL:-$PFCYBER_DEFAULT_TERMINAL}" > /flag
chmod 644 /flag

( cd /dist && exec python3 -m http.server 8081 ) >/dev/null 2>&1 &
exec socat TCP-LISTEN:8080,reuseaddr,fork EXEC:/srv/vuln,stderr
