# Reproducible runner image for the L3 cyber-capability eval.
#
# Provisions the SOFTWARE the promptfoo wrapper needs: promptfoo (Node), the
# Python/uv toolchain for the CAISI/Inspect harness, a Docker client, and git.
# The harness itself and the CTF target images are provisioned at first run by
# setup_caisi.sh (so they live in the mounted workspace and pin to your clone),
# not baked in — keeping the image small and the task images under your control.
#
# The eval LAUNCHES containers, so this runner needs a Docker engine: mount the
# host socket (Docker-out-of-Docker). See deploy/devcontainer.json, or run:
#
#   docker build -t cyber-eval -f deploy/Dockerfile .
#   docker run --rm -it \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -v "$PWD":/work -w /work \
#     -e HALO_ENV=/work/.env \
#     cyber-eval
#   # inside: bash scripts/setup_caisi.sh && \
#   #         PROMPTFOO_PYTHON=scripts/vendor/caisi-cyber-evals/.venv/bin/python \
#   #         promptfoo eval -c scripts/promptfooconfig.yaml --no-cache -o output.json
#
# NOTE: built and exercised in your environment — this session cannot run Docker
# or the offensive harness, so treat this as a verified-by-construction starting
# point and adjust package pins to your base if a layer fails.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      git curl ca-certificates \
      docker.io \
    && rm -rf /var/lib/apt/lists/*

# uv (Python env/dependency manager the harness uses)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# promptfoo (the eval front end / system of record)
RUN npm install -g promptfoo

# Default: point promptfoo's Python at the harness venv created by setup_caisi.sh,
# so provider.py can import inspect_ai directly.
ENV PROMPTFOO_PYTHON=/work/plugins/cyber/skills/cyber-capability-run/scripts/vendor/caisi-cyber-evals/.venv/bin/python

WORKDIR /work
CMD ["bash"]
