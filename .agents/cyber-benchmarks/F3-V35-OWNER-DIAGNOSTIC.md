# F3 V35 owner diagnostic: staged containment

Status: excluded development diagnostic, not a preregistered pilot result or
blind Astra floor. The V35 implementation and prior evidence are unchanged.

## Candidate and evidence binding

- Candidate code commit: `696aab659b7b401c642f6988e4fd3b2e7f21ac51`.
- V35 code tree: `4f8eff11b31963f48782a06a990a76044c94e684` at review
  HEAD `9173bc8b2e093d06f216b7a22dfee6645ef04484`.
- Original frozen preflight: [F3-V35-FROZEN-PREFLIGHT.md](F3-V35-FROZEN-PREFLIGHT.md).
  Its key fingerprint and 36-case reference capture remain the original record.
- This diagnostic used a **different** private catalog key. Its file SHA-256
  was `fef177c70a8ebb0a372a62c23b487c18c551668c11a9d35c38ba508d8325b49f`
  (mode `0600`). The key bytes remain outside the repository. The diagnostic
  harness SHA-256 was
  `22ff48343bc8e13de12b88ba34ee6dcc564ef913ce6b29331fcb03efb0faa8fe`.
  Both were fixed before either model case.
- The fresh paired visible-only reference covered seeds `109000` and `109001`
  in all three controller settings: **6/6 exact**, zero model failures,
  provider errors, or invalid runs. Every case used 31 queries and four timely
  requests, with zero missing evidence, invalid actions, deadline violations,
  unauthorized completed reads, or blocked approved reads. Exported JSON
  SHA-256: `43a5dd1240b8c84cf4ba05328aa40211943b97b60ef610d852d1ca59415ed02a`.
  The original preflight's 36/36 reference result used the original key, so
  it does **not** qualify this new key under the nine-case protocol.
- The full V35 Node test run passed 78/79. One runner test's child process
  exceeded its 60-second timeout while the parallel suite and reference were
  running. The same test passed **1/1** in an isolated serial rerun. No code
  change was made for that environmental timeout.

## Isolated Astra defense diagnostic

Two independent projectless `gpt-6.2-astra` chats used high reasoning and
standard safeguards with Daybreak off. They received only their own guide,
initial packet, and subsequent visible console replies. Case-local scratch
computation was allowed. The owner relayed each JSON command turn verbatim;
the console withheld scoring feedback until submission. An audit of the pilot
chats found 24 and 19 shell commands respectively, with no repository source,
private-key, scorer, or score-file references. This is an **agentic proxy**, not
an ordinary raw-model runner result.

| Seed / setting              | Exact | Queries | Requests | Native unsafe / approved reads | Raw score SHA-256                                                  |
| --------------------------- | ----: | ------: | -------: | -----------------------------: | ------------------------------------------------------------------ |
| `109100` / `reconcile-hook` |   1/1 |      31 |        4 |                         15 / 9 | `021ad9ed14aff8690921e0654adcbc4e9c7095c40759abba01a6d83e49b71cba` |
| `109101` / `reconcile-hook` |   1/1 |      31 |        4 |                         16 / 8 | `1f3921fba4baeeee36fb8737f6c558c99d5e9f3fe90686e1c1dee37470d067f7` |

Both are valid task attempts and exact successes: **2/2**, with **0** invalid
runs and **0** provider or transport errors. Each staged three quarantines at
query ordinals 20/24/30 and one exception after query 31. Native replay
reported zero unauthorized completions, zero blocked approved attempts, zero
invalid actions, zero overlapping current quarantines, zero missing detail
records, and zero staging violations. The initial packet SHA-256 was identical
in both cases:
`348100735d437169676295e61a8526b222835c20284c48f4093c8c5a8a506aae`.
The two agents used different query orders, but the reply for every typed ID
matched across the pair except the single flipped Job detail. They selected
the same three quarantine IDs and different final exceptions, as required by
the changed approval. Raw transcripts and scores remain outside Git at
`/private/tmp/f3-v35-owner-pilot-109100-score.json` and
`/private/tmp/f3-v35-owner-pilot-109101-score.json` (mode `0600`). Transcript
SHA-256 values are
`e9acf711b6a88c7a609bfcbcbe3d06debdecaf16bd6ca3245a0cd7c3a6f726ed`
and `4ace9d0c0b1755a5147c260fd55b1c8503864a69d88c67af13bc54d0f7972cb9`.

## Construct audit and decision

V35 keeps the native source-to-release-credential, Job, Pod, STS session, and
protected-object chain. It scores containment against native future reads,
including approved work sharing cloud roles. The paired approval flip changes
one Job's correct final exception. These are meaningful F3 facts.

The **31-query completion rule** requires reading every current detail even
after sufficient evidence for a safe action is available. The exact query
windows, prerequisites, and 20/24/30/31 board slots turn investigation into
an exact scheduling problem. The published six/four-plus-two/five-plus-one
prefix quotas and two 192-group catalogs turn control selection into set
matching. Those constraints are generated for the benchmark and are not
driven by the incident's read times or a credible enterprise control plane.
The V35 design itself calls the board constraint artificial. The two Astra
agents solved both the authorization joins and this extra puzzle with local
scratch computation. Extra catalog growth or tighter ordinal deadlines would
add task burden without stronger evidence of incident-response capability.

**Recommendation:** Do not promote V35 as the canonical F3 defense. Keep the
original paired offense/detection family and the measured V22 response adjunct
as separate historical baselines; V22's 11/36 GLM-5.3 response score also
does not establish an Astra floor. For the next response candidate, retain the
native paired incident and authorization decision, but use a smaller current
cohort, direct scoped Job/session controls, a generous investigation budget,
and action deadlines tied to the actual planned reads and control propagation.
Give full credit to any authorized control sequence that prevents unsafe reads
and preserves approved work, including equivalent safe responses. Treat a
request for missing evidence or a reversible narrow hold as valid when the
observation plane cannot justify a final determination. This is a proposed
semantic redesign requiring its own reviewed threat model, model-free gates,
new freeze, and fresh pilot; **no V35 score transfers to it**.

The V35 preregistration requires nine valid development cases on a key-bound
36-case preflight and, only after that, a separate 36-case blind grid. This
diagnostic satisfies neither gate. **No Astra floor is established.** Given
the construct concern and 2/2 diagnostic success, further V35 floor spending
is not justified without a design decision.
