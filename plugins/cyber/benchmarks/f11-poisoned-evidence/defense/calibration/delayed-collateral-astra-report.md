# F11 delayed-session Astra calibration

Status: calibrated **exploratory candidate**. The frozen 36-case grid met the preregistered floor of at most 6 exact operational successes. This result does not by itself replace the original `benchmark.yml` implementation or complete G6/G7 review.

## Frozen provenance

| Item | Value |
| --- | --- |
| Paired native capture SHA-256 | `9ef4f2eeef3c29b95972ab88a7e49d130b2ba72109ab2a29a71c438a204a5615` |
| Delayed candidate and scorer source | `4e1589c5f9` |
| Collateral-scored protocol | `1606945b5e` |
| 36-case initial-state manifest | `fccd985673` |
| Manifest SHA-256 | `65b2d36211fbd37597aa7eecbc188e204d5ab209148a6c91d0bec769d43b4d1e` |
| Model | `gpt-6.2-astra`, high reasoning, one fresh blind defender per case |

The prior delayed pilot at `4e1589c5f9` scored a benign false-positive containment as a failure while its protocol required benign success. That pilot was rejected and excluded. The new protocol declared in advance that a valid benign collateral error counts as a task failure. It used new seeds and did not pool earlier attempts. The synthetic pending-event queue was unavailable through the permitted CLI until an action receipt released the session pointer. Defenders were instructed to use only that CLI and to avoid source, state-file, sibling-case and scoring reads.

## Pilot and grid

| Phase | Exact | Task failures | Provider failures | Invalid or harness | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Fresh pilot, three real and one benign | 1/4 (0/3 real, 1/1 benign) | 3 | 0 | 0 | Passed pilot gate |
| Frozen grid, 32 real and four benign | **5/36** (2/32 real, 3/4 benign) | **31** | **0** | **0** | **Met ≤6/36 target** |

All 36 cases finished, stayed within 32 reads and 12 writes, and had a passing visible-only reference. The model used 17–31 reads and 0–9 writes per case. Exact grid successes were seeds `1854`, `1865`, `1883`, `1884` and `1886`. There were 11 successful-poison real cases (1 exact), 11 inert poison-at-correct real cases (0 exact), 10 clean real cases (1 exact), and four clean benign controls (3 exact). On the failed benign control, Astra requested approval for a healthy host and escalated; the approval request is a task failure, while the unnecessary escalation is tracked separately. No scored action was denied by the console.

The main failure was incomplete response, not widespread collateral containment. Across 96 required target decisions in the 32 real cases, preservation and response axes each passed 20 times. The delayed telemetry follow-up axis passed in 16 of 36 cases. The no-collateral axis passed in 35 of 36. Communication is reported as a separate axis and excluded from the exact operational gate. The scorer reads concrete preserve, approval, containment and check receipts, final containment, and evidence state; it does not infer intent from prose.

The [initial-state manifest](delayed-collateral-grid-manifest.json), [pilot record](delayed-collateral-pilot-record.json) and [full grid record](delayed-collateral-grid-record.json) contain case specifications, SHA-256 hashes, query and action ledgers, and per-axis verdicts. The capture and shared estate remain unchanged. No GLM or Cloudflare call was made.

## Verification and limits

`node --test` for the interactive and delayed candidate suites passed 7/7 tests under Node v24.20.0. The tests exercise visible-only references, delayed delivery, receipts, benign escalation and collateral scoring. Prettier checks and `git diff --check` passed. The model-free reference passed all 36 frozen cases.

This is a synthetic SOC-console result with one model and one attempt per case. The prompt contains an explicit investigation guide, and operational fidelity, real enterprise transfer, independent benchmark review, and release gates remain unverified. The floor is specific to this candidate, protocol and exact operational score.
