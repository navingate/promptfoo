# Cyber Benchmark Authoring Skill Validation

**Status:** PENDING behavioral comparison

This record separates deterministic contract validation from live agent behavior. Missing provider access or an unrun matrix remains visible and does not become passing evidence.

## Test environment

- Contract suite: `test/agentSkills/cyberBenchmarkAuthoringSkill.test.ts`
- Provider: `openai:codex-sdk`
- Model: `gpt-5.5` configured; execution PENDING (the repository's Codex SDK provider does not yet recognize `gpt-6.1-sol`)
- Reasoning setting: `high`, identical for baseline and assisted trials
- Opportunity budget: one attempt per case with identical provider configuration; the Codex SDK does not expose a hard token or action cap
- Baseline isolation: statically verified in `/tmp` with a clean `CODEX_HOME`; runtime trace PENDING
- Assisted isolation: statically verified in a sibling project containing exactly one skill copy; runtime trace PENDING
- Request digest method: SHA-256 over the exact UTF-8 request
- Behavior-case bundle digest: `9a527099a54c511679809b974e3ebf7d68724b9c7126957d31dfd38f72e15565`
- Generated comparison-config digest: `9a1ec3a945fbb7982ed333570597c107ff4f97e375214bd7a7f3e1f26746b507`

## Baseline observations

| Case                     | Request digest                                                     | Model   | Result  | Short rationalization |
| ------------------------ | ------------------------------------------------------------------ | ------- | ------- | --------------------- |
| `offense-rush`           | `3cd7500db9e74da4f28f1ca23e48a9171600c02cc08f615059e418f7b60877c3` | PENDING | PENDING | PENDING               |
| `defense-oracle`         | `327fdd72a594c6ec986de9ac81c3f94429b46b6253bb0403fca66377990d9829` | PENDING | PENDING | PENDING               |
| `claim-overreach`        | `54e4965ec2509e5512a3167042c6d3567c0e4c231f3729847d6090872ab1b0db` | PENDING | PENDING | PENDING               |
| `real-product-overbuild` | `25638f458c96b19a8dbb527f4ead224d1f5d8cdd49faed56d73081ad92c9d0e5` | PENDING | PENDING | PENDING               |

Baseline isolation must show that no ancestor directory or `CODEX_HOME` can resolve `cyber-benchmark-authoring`. At least one material baseline failure is required before behavioral completion.

## Assisted observations

The assisted run must use each baseline request byte-for-byte, with the same model, reasoning, sandbox, output schema, and opportunity budget. Every mandatory criterion must pass; improvement without full compliance is a failed case.

| Case group          | Status  | Required evidence                                                                            |
| ------------------- | ------- | -------------------------------------------------------------------------------------------- |
| Four pressure cases | PENDING | Correct mode, construct, counterfactuals, de-oracling, achieved claim, and adoption decision |
| Incident response   | PENDING | Correct routing and outcome semantics                                                        |
| Tool conduct        | PENDING | Authorization, usefulness, safety, and side-effect separation                                |
| Paired relationship | PENDING | Separate producer/consumer modes and reciprocal contract                                     |
| Small boundary      | PENDING | Scale-down without copying F2 complexity                                                     |

Assisted isolation must resolve exactly one skill copy and record reference-loading evidence.

## Routing

Routing evidence is PENDING. Positive cases must select one canonical mode and only the references required for the active phase. Pairing may add the telemetry-and-twins reference without becoming a mode.

## Negative routing

Negative routing is PENDING for `ordinary-promptfoo-eval` and `application-security-review`. Each passes only when the skill invocation count is zero.

## Deterministic checks

On 2026-10-05, the focused skill, tooling, and auditor suites passed 60/60 tests. `promptfooPlugin.test.ts` passed 124/124. The skill quick validator, Biome check, and Prettier check passed. The existing cyber-plugin suite passed 12/13 inside the restricted sandbox; its Gate-0B verifier test was blocked by `PermissionError: [Errno 1] Operation not permitted`, matching the known sandbox-only failure and requiring an outside-sandbox rerun.

The behavior preparer created ten cases and fourteen trials with identical pressure prompts, sibling workspaces, clean local homes, an uncontaminated baseline ancestry check, and exactly one assisted skill copy. The first live command failed before provider execution because the restricted sandbox denied the `tsx` IPC socket. The outside-sandbox retry was interrupted before execution. No model result is inferred from either infrastructure event.

## Limitations

No live baseline/assisted result, model/version, result digest, or routing trace is claimed yet. This file must be updated from fresh isolated runs before the skill is described as behaviorally complete.
