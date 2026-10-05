# Telemetry and Paired Twins

## Observation plane

Build the observation-plane manifest from the fully staged model context, after templates, adapters, and serialization. Enumerate every model-visible source category even when empty:

- prompts;
- files;
- telemetry;
- tool descriptions;
- feedback;
- exposed environment values;
- artifacts;
- serialized results.

Each file-like source has a task-relative path and SHA-256. Exposed environment entries identify the name, classification, and value digest without copying secrets into the manifest. Reject any staged input absent from the manifest.

The evaluator-only forbidden inventory may name forbidden key names, paths, exact value digests, literal prefixes, and path-style globs. Scan recursively through keys and scalar values. Regex matchers are not supported. Finding no declared forbidden value does not prove that the inventory is honest or complete; reviewers own that decision.

## Native and normalized telemetry

The producer owns native facts and capture generation. Native events use versioned schemas, unique event IDs, principal/session/workload/flow references, source time when available, arrival order, and causal references to compatible earlier events.

The consumer owns normalization, labels, and scoring. Normalization may rename fields, change shape, redact secrets, and derive a value from declared native sources. It may not invent security-relevant actions, provenance, assurance, authorization, or completion.

Field lineage classifies every normalized field:

- `native`: exact source event and source path;
- `derived`: exact source fields plus a stable transform ID;
- `synthesized`: presentation or transport metadata only, with a rationale.

Every security-relevant, scoring-input, or label-input field must be native or derived. A synthesized field must set `security_relevant`, `scoring_input`, and `label_input` to false.

## Pairing contract

Pairing is reciprocal metadata, not a task mode. Each task retains its own mode, primary construct, gates, calibration, and claim.

Both manifests declare the other task ID, opposite `producer`/`consumer` roles, and the same `pair_contract_version`. Suite records resolve each task path. The producer proves emitted facts. The consumer proves that captured events normalize and score without synthesized security facts.

A Level 3A capture manifest binds:

- source commit supplied to the auditor;
- producer and consumer task IDs and versions;
- pair contract version;
- `estate-generated` designation;
- reviewed redaction status;
- immutable capture paths and hashes;
- field-lineage path and contract ID.

Include malicious and matched benign captures that exercise the same privileged operations. Consumer conformance must run against captured producer evidence, not a separately hand-authored lookalike.

## Causal and timing checks

Causal references must be scalar IDs, point to earlier events, and stay within compatible session, workload, or flow relationships. Duplicate IDs, impossible time/order relationships, and missing principals fail validation.

Preserve native source time and arrival order when emitted. Synthetic display order may improve presentation but cannot feed labels, scoring, provenance, or early-detection claims. Use event-anchored timing for detection and response measures.

## Review questions

Reviewers challenge whether source fields actually carry the declared meaning, whether redaction changes the construct, whether the adapter hides missing facts, whether labels remain evaluator-only, and whether estate-generated captures justify only the named paired-grounding claim.
