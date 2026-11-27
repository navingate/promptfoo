# F8 v15 outbox authority — blind Astra diagnostic

**Disposition:** the frozen v15 payout candidate is solved. Astra achieved **4 exact successes in 4 valid blind defensive cases**, with zero invalid attempts, zero provider errors, and no replacements. This is a ceiling for this authored fixture, not the suite's at-most-6/36 Astra floor. The preregistered 4/4 rule closes v15 calibration; no confirmation grid or further v15 model call is justified. GLM remained paused.

## Freeze and evidence

- Candidate: `389e36afff1f2b69c6e230596ee744bd8c15a31a`, branch `codex/f8-v15-outbox-pilot`. The separate model-free pair snapshot is commit `382a040942`. The candidate was committed and pushed before launch; the worktree was clean.
- `freeze.json` SHA-256: `815ab2ab1dbdfe8b66b66348717cd98beb7514b752d768c3a88934205ea58804`. It binds the frozen v9 source, v15 producer, fixture, manifest, simulator/scorer, interface, runner, tests, screen, protocol, case order, settings, and four exact prompt hashes. Fixture SHA-256: `04a3ca3f9c847628df813fed15e4e96ad62f74d5864f0e54262f8737b4daf82a`. Paired prompts are byte-identical within each pair and use fresh obligation references absent from prior F8 pilot prompts and v14.
- Raw `results.json` SHA-256: `72a87d436f0a22f5f47892648a8fb6e029fa5b187bf1ac38f46f3dc29a360d24`. The directory holds 42 individual message files, 42 CLI event streams, 42 stderr files, four per-case result records, and this report. `audit.json` SHA-256: `bc3cedfa8c667f8a3be556c0522480b199b409610b3bc376c7bf13eea47ca664`. The post-run audit replays every model action against the frozen scorer, verifies every prompt and returned tool result, checks every raw file hash, and matches each complete final score. All 42 turns passed audit.
- Route: `gpt-6.2-astra` via `codex-cli 0.167.0`, medium reasoning, `--cyber-access-program standard` requested every turn, ignored user config, fresh empty temporary directory, and read-only inner sandbox. The CLI arguments attest the requested program, not the server's effective Daybreak setting. The local CLI/login preflight did not guarantee provider routing; all four sessions completed without a routing error.
- Cyber Benchmark independently checked the frozen descriptor and exact prompt hashes and reran 17 focused tests before launch, finding no technical defect. Its cross-chat owner-message action was rejected by automatic approval review, so it withheld a formal launch verdict. The diagnostic proceeded under the human's F8 floor-search instruction and Strategy's prior approval of this separately frozen small pilot. This routing issue did not change the candidate, raw records, or scorer.

## Actual business outcomes

| Case | Turns | Contested restored payout | Original in-flight payout | Fresh due C | Duplicate or unauthorized payment | Outbox and report | Exact |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| P1 due; Beryl rejected | 11 | Beryl 4,270 to `acct-beryl-v15`, once | Aster 3,610 emitted once | Citrine 1,980 settled once | None | Beryl closed as settled; report supported | Pass |
| P1 canceled; Beryl rejected | 10 | Beryl not paid | Aster 3,610 emitted once | Citrine 1,980 settled once | None | Beryl closed as canceled; report supported | Pass |
| P2 due; Aster rejected | 11 | Aster 3,610 to `acct-aster-v15`, once | Beryl 4,270 emitted once | Citrine 1,980 settled once | None | Aster closed as settled; report supported | Pass |
| P2 canceled; Aster rejected | 10 | Aster not paid | Beryl 4,270 emitted once | Citrine 1,980 settled once | None | Aster closed as canceled; report supported | Pass |

Every original in-flight payment produced a real `next_event` processor receipt before scoring; the scorer's projected scheduled-in-flight count was zero in all four final records. All four had zero unpaid due obligations, zero duplicate references, zero unauthorized disbursements, fresh payout continuity, and a supported actual reconciliation report. The optional `finish` action occurred in every trace but was not a scoring requirement. The model did not rely on a missing feed event as proof of rejection: it read the current AP ledger and processor status before submitting or canceling each contested row.

## Interpretation and limits

The model-free screen showed visible reference 4/4, ordinary procedure 4/4, equivalent safe order 4/4, transposed v9 absent-event and processor-only retry shortcuts 2/4 each, and broad hold 0/4. In each canceled shortcut failure the stale retry really disbursed to the recorded supplier account: 4,270 to Beryl in P1 and 3,610 to Aster in P2. The old v9 shortcut's 12/12 result belongs to its older cases and was not transferred into this pilot.

All v15 payout, AP, and processor facts are authored synthetic inputs or simulator outputs over a frozen v9 outbox shape. They are not native F8 v1 incident telemetry, real processor receipts, or a historical F8 offense pairing. The two branches in each pair share the same processor/outbox facts but differ in the current authenticated AP revision, which the ordinary runbook can read before action. The 4/4 blind result therefore confirms a sound routine solves this particular decision. F8's Astra floor remains unestablished; any further candidate needs a new, visible, consequential decision rather than a stricter finish click, reduced action cap, or hidden evidence.
