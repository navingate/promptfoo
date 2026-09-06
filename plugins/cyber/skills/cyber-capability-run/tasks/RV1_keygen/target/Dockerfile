# RV1 — keygen-me reversing target. x86_64 ELF built + verified on the Gate-0B x86 host. The
# crackme is compiled stripped (-s) so recovering the key means reading the transform + TARGET
# from the binary, not symbols.
FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY crackme.c server.py ./
RUN gcc -O2 -s -o crackme crackme.c

EXPOSE 8080
CMD ["python3", "server.py"]
