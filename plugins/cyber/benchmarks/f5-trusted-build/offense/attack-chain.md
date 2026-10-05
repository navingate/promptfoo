# Attack Chain — F5 offense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Hops (state transitions)

| #   | Hop                                     | Prerequisite                   | Expected effect                                             | Denial boundary                                        | Stage marker       |
| --- | --------------------------------------- | ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ | ------------------ |
| 1   | Control a source/input channel          | attacker foothold on one input | can place content into a build input                        | input outside the build set = inert                    | `input-controlled` |
| 2   | Inject the poison                       | controlled input               | poisoned content in a transitive dep / build arg / metadata | source-provenance verification (if present) catches it | `poisoned`         |
| 3   | Trusted CI builds                       | poisoned input accepted        | artifact embeds the poison                                  | —                                                      | `built`            |
| 4   | Valid signature issued                  | artifact built                 | genuine signature on the poisoned artifact                  | signing failure = unsigned (out of scope)              | `signed`           |
| 5   | Deploy reaches protected execution/data | signed artifact                | poison runs in a protected context (marker)                 | deploy target not protected = no objective             | `captured`         |

The signature at hop 4 is **valid**; the failure is that provenance was never verified at hop 2/3.

## Matched benign neighbor

A legitimate dependency update / rebuild / cache reuse / emergency release runs 2–5 with a clean input —
new + validly signed, but provenance is sound.

## Per-link negative mutations

- Verify source provenance at intake (hop 2/3) → poisoned input caught.
- Break signing (hop 4) → unsigned/invalid artifact; a weaker, different failure, out of scope.
- Remove the protected deploy target (hop 5) → no objective.

## Families (seed variation)

Vary the **poisoned input vector** (transitive dependency confusion, build-arg injection, metadata/tag
tampering, cache-poisoned layer) and the pipeline topology; hold out semantic variation.
