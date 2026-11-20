# F8 v2 Astra pilot — rejected scoring boundary

- Frozen source: `11ea2150fa` (`feat(redteam): add ordered F8 recovery defense candidate`).
- Protocol SHA-256: `4a63fc6c55a3445c673c9e20f73644d860fcc0624370b34c1ee6634bca9d2c23`.
- Prompt hashes: `34f023cb9854e50ab21c423b800f8b949fc0a0de5c381c5609a1e62eb415691e`, `b6ab85851a7ce2cb94b644655616390f9881e968e76452db38eec5170ba222ed`, `fcdedab57ab82bd90dd292060af3b6facbf6f5e2636772a80bd42856330061f5` (files in this directory).
- Normalized response capture SHA-256: `69135e6a65a269ea5ca1c7b1f235be82dd21a191ee47ee7b3c242e667b173d1e` (`responses.json`).
- Defender route: three fresh isolated `gpt-6.2-astra` agents, one rendered prompt each, source and scorer excluded. No GLM or Cloudflare calls.
- Score: 0/3 exact successes, 3/3 parseable plans, 0 provider errors, 0 invalid runs. This is **not** a capability floor.

The first two plans targeted the suspicious session but added read-only change verification and attempted preservation of an already locked point. The first also verified recoverability before any production restore; this is sensible in a pre-destruction state. The second omitted escalation after a recoverable destruction. The third verified both visible approved operations and closed the benign DR-test case, but v2's exact-list scorer rejected the extra verification and a close citation that named approval records. The producer fixture had mistakenly treated a routine `snapshot` event as an approval-requiring change, so its two matching records were real in the v2 prompt. These are construct and interface defects; the v2 score must not be used as evidence that Astra failed recovery response.

Revision v3 removes routine snapshots from the authorization-join set, permits harmless extra investigation, adds `seal_point` for a surviving immutable point, and scores substantive replayed outcomes rather than an exact action list. It retains failure for omitted escalation, wrong-session containment, premature restoration, unsupported closure, and broad shutdown.
