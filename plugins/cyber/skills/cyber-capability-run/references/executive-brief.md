# Enterprise offensive-capability benchmark — executive brief

_A contamination-resistant, reference-solve-validated benchmark that measures whether a
model can perform realistic enterprise offense (app / cloud / identity / multi-stage
intrusion), run through promptfoo on the UK-AISI Inspect + NIST-CAISI harness._

## The one-line

On identical scaffolding, a mid-tier 35B (Qwen) solves **22% of public Cybench** (elite
CTF) but **78% of our single-skill enterprise tasks and 45% of our multi-hop chains** —
public CTF **understates** real-world offensive capability, and our suite measures the
capability enterprises actually care about.

## Scorecard (Qwen 35B, Pass@3, Gate-0A contained)

| Suite                          | Reliable (3/3) | Pass@3      | Coverage |
| ------------------------------ | -------------- | ----------- | -------- |
| Public **Cybench** (elite CTF) | 5/37 · 14%     | 8/37 · 22%  | 37/40    |
| Our **atomics** (single-skill) | 28/36 · 78%    | 33/36 · 92% | 36/36    |
| Our **multi-hop chains**       | 5/11 · 45%     | 8/11 · 73%  | 11/11    |

Reliable = solved in all 3 runs · Pass@3 = solved in ≥1 · 0 infrastructure errors across
all 47 authored tasks.

## Three findings

1. **Public CTF understates enterprise offense.** The same model that struggles with
   crypto/pwn/rev competition tasks (22%) reliably performs realistic app/cloud/identity
   attacks — broken access control, IDOR, SQLi, SSRF, IMDS theft, IAM privilege
   escalation. That is the threat surface enterprises live with.

2. **The honest ceiling — and where the signal is.** Single-skill tasks are a **floor**
   (a mid model clears 78%; a frontier model would near-saturate). The discrimination
   lives in the **multi-hop chains** (45% reliable) — and it is measurable: **each added
   hop sheds solve-rate.** Qwen reaches stage 1 of the PKI chain then cliffs; decays hop
   by hop on the AD→cloud chain. That depth-degradation is the empirical case for a
   deeper Frontier tier (5–8-hop, discovery-first chains) to discriminate at the top.

3. **Integrity as a feature.** Every reported hard task is **reference-solve-validated** —
   running the solves caught (and fixed) two targets that were _broken_, not hard, before
   they could masquerade as capability gaps. Scored under **per-run nonces** so a
   memorized answer earns nothing. All 47 enterprise + 7 exploit-dev (pwn/rev) targets are
   confirmed solvable. This is what "as rigorous as Cybench" has to mean in practice.

## Positioning

An **enterprise-relevant offensive-capability benchmark** — not "a harder Cybench." The
value is measuring practical offense with a discriminating multi-stage tier, freshly
built (no bit-rotted public images) and contamination-resistant, with a validated
difficulty gradient that a frontier model can be scored against.

## Method (why the numbers are trustworthy)

- **Contained execution:** dedicated x86 VM, host-layer egress lockdown (model endpoint
  the only reachable destination), self-tested boundary before every run.
- **Pass@3** (3 independent runs) to separate reliable capability from run-to-run
  variance; per-run-nonce mode removes contamination.
- **Reference-solve validation** of every target (`verify_refsolve_hostonly.sh`,
  `verify_pwn.sh`) — a broken target is caught, not scored.
- Public Cybench run through the **same** harness as a calibrated cross-check.

## Status & next

- **Done:** Qwen validated across Cybench + atomics + chains; 47 enterprise + 7 pwn/rev
  targets validated; scorecard (`scorecard-qwen.md`).
- **Next:** a stronger SUT (Azure DeepSeek) for headroom/calibration; the deeper Frontier
  chain tier; the Gate-0B assurance measurement (microVM-per-run, out-of-band verifier,
  Pass@k with Wilson intervals — `methodology-note.md` §8).

_Source of truth for the numbers: `scorecard-qwen.md`. This brief is the narrative summary._
