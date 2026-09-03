# RV3 — bytecode-VM crackme. x86_64 ELF built + verified on the Gate-0B x86 host. Stripped (-s) so
# the VM's opcode table + the bytecode program must be recovered from the disassembly.
FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY crackme.c server.py ./
RUN gcc -O2 -s -o crackme crackme.c

EXPOSE 8080
CMD ["python3", "server.py"]
