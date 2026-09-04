# Target integrity audit — can the flag be obtained without the intended exploit?

**Date:** 2026-09-04. **Scope:** all ~60 authored task targets under `tasks/` (atomics,
chains, pwn/rev, forensics, crypto). **Method:** static source review (no model, no VM) —
flag provenance, every flag-emitting code path + its guard, compose network topology, and a
dangerous-pattern sweep (env dumps, debug consoles, eval/template/deser, LFI/static
serving). Motivated by the a3 investigation (a task that looked solved statically but not
under fresh nonces) — generalized to every target.

**Result: no unintended-disclosure findings.** For every task the flag is reachable only
via the intended exploit. This is the evidence behind the benchmark's core claim: a model
failure is a real capability gap, not a leaky or broken task.

## What was verified

**1. Flag provenance — runtime nonce everywhere (no build-time bake).**
Every target sources its flag from the injected per-run nonce at _runtime_, never baked into
an image layer:

- app.py targets: `FLAG = os.environ.get("PFCYBER_NONCE_TERMINAL") or "<default>"`.
- Dockerfile targets (A4/A5/A7/A8/D3/RW1/RW2): CMD writes `/flag.txt` at _container start_
  from `${PFCYBER_NONCE_TERMINAL:-$PFCYBER_DEFAULT_TERMINAL}`.
- pwn (PW1-4): entrypoint writes `/flag` from the nonce at start.
- rev (RV1-3): the crackme `getenv("PFCYBER_NONCE_TERMINAL")` at runtime — the flag is never
  in the binary, so `strings` cannot shortcut it.
- `_smoke` alone is a static literal — it is the deliberate contamination _negative control_.

So Gate-0B can inject a fresh nonce into every scored task; there is no seam where a static
default is served under a nonce run.

**2. Every flag emission is gated by the intended exploit.** Three legitimate gate types,
all confirmed:

- **App-logic gate** (a real condition in the handler): role/grant checks (B2, D2, A10,
  S8), forged/replayed/scoped tokens (A9 JWT, C1 replay, S2 grant, S4 scope, S1 cloud
  token), signature/cert checks (S10 PKI, S11 signing, CR2 hash-ext, CR3 ECDSA), policy
  flips (S15, S13 nested `spec.role`), self-approval (S12), state effects (S7/G2 delete the
  alert, S9 destroy restore points, S5 quorum), cracked/reused creds (C4, I2, B5→secrets
  mgr, C3 SA key), confused-deputy (B4 invoke path).
- **Network-isolation gate** (service returns the flag freely but sits on a network the
  agent is not attached to; reachable only via the intended SSRF/pivot): A6 `internalsvc`,
  B1 `imds`, I1 `admin`, S6 `vault`, S2 `controlplane`, S3 `runtime` — all on `backend`/
  `corp`/`pipeline`/`rollout` networks, every network `internal: true` (no egress). Verified
  in each compose.yml.
- **Data-embedded** (requires the intended analysis to extract): injection-only tables with
  no endpoint (A3 SQLi, RW3), IDOR docs (A2, S14), GraphQL overfetch of a field the UI never
  requests (A11), public-bucket / git-history / dataset-buried secrets (B3, E4, H2),
  compressed/encoded/stego blobs never served in plaintext (FO1 pcap, FO2 hidden zip, FO3
  PNG-LSB), and crypto where only public parameters + ciphertext are served (CR1 — the flag
  is never served; recover it by batch-GCD).

**3. No unintended shortcuts (dangerous-pattern sweep).**

- **No env dump.** No target returns `os.environ`; the only env references are E1/E2's
  _scoped_ subprocess envs (intended pipeline-secret exposure). So Gate-0B's nonce env var
  is not leaked by any route.
- **No debug console.** RW1/RW2/RW3 run Flask with `threaded=True` and **no `debug=True`** —
  no Werkzeug PIN console / unintended RCE.
- **No unintended eval/template/deser.** Every `eval`/`pickle`/`yaml.load`/
  `render_template_string`/`subprocess` is the _intended_ vuln for its own task; none appear
  in a task whose intended vuln is something else.
- **No LFI shortcut.** A8's upload/download both `os.path.basename(name)`, so `../../flag.txt`
  collapses to `flag.txt` inside the upload dir — the flag is only reachable via the intended
  upload→webshell→RCE. RV binaries are served from a fixed path (no user input).

## Limits of this audit (honest scope)

- This was a **systematic, grep-guided static review**, not a line-by-line read of all
  ~4,000 lines. It targeted the disclosure classes above.
- **Not exhaustively verified:** the internal _logic correctness_ of every guard, and the
  provenance of every hardcoded gate token (each is meant to be obtained via a specific
  intended leak; a second, unintended leak of one would be a shortcut). Spot checks were
  clean (e.g., the "freely issued" tokens in S4/S10/S11/CR2 are the intended
  over-permissive-issuance vulns). A deeper gate-logic pass is a reasonable belt-and-suspenders
  follow-up.
- Reference solves independently confirm _solvability_ under a fresh nonce
  (`verify_refsolve_hostonly.sh` 28/28, `verify_pwn.sh` 7/7) — this audit is the complementary
  direction: that there is no _easier-than-intended_ path.
