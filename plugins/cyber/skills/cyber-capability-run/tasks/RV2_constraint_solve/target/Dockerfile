# RV2 — constraint crackme. x86_64 ELF built + verified on the Gate-0B x86 host. Compiled stripped
# (-s) so the constraints must be read from the disassembly, then handed to an SMT solver.
FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY crackme.c server.py ./
RUN gcc -O2 -s -o crackme crackme.c

EXPOSE 8080
CMD ["python3", "server.py"]
