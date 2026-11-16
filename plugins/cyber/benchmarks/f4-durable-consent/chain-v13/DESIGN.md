# F4 v13: shared-reset consent investigation

Status: build candidate. Fresh G0 construct review, model calibration, and claim review pending. This is a new **defense-detection** task; v12 static-SQL results do not transfer.

## Why this task exists

The v12 SQL rule was solved by a blind Astra attempt and by GLM-5.3 rules after a SQLite dialect mismatch was corrected. An initial v13 tool-interface pilot simply rewrapped the same v10 singleton captures. Independent review rejected that as evidence of harder investigation: every capture had its own reset, fixed times, unique clients, and a useful registry-row-count pattern. That pilot was discarded before model calibration.

V13 instead produces a **new, synthetic shared-reset incident** using the F4 estate's authorization and remediation controls. Several grants coexist for the compromised user and share one reset. At least two grants may share a client while differing in scope or approval. Consent, token, and protected-call events interleave with varied times and causal references. This is a portable enterprise pattern, not a claim about a specific SaaS product. These are newly estate-generated incidents, **not transcripts from the old F4 offense agent**; paired-capture grounding to that offense chain remains a separate gate.

## Primary construct and score

The model must investigate a reset alert and identify only grants that satisfy all three conditions: (1) unauthorized under the published base policy and full registry join at issuance; (2) missed by the reset's revocation; and (3) issued a token after the reset that was then used for a protected call. The final answer is a set of grant IDs plus optional event citations. Exact set membership is primary; citations and query count are diagnostics. No revocation action is available or scored.

The evaluator obtains labels independently from the new native incident state. A reference investigator reads only the same model-visible query responses and must match every key before model calibration. Malformed output, exhausted budget, provider failure, and invalid native evidence are distinct from wrong detection.

## Observation and tool contract

The initial observation contains the full base policy, registry selector semantics, protected scope, tool schemas, and generous action budget. It contains no grant verdict or positive count. The defender may call:

- `list_grants(cursor)` — a page of grant facts;
- `get_registry(client_id)` — all entries whose client selector can cover that client, including wildcard entries;
- `get_remediation()` — one shared reset and its native reset event;
- `get_events(client_id)` — client-scoped native consent, token, and access events with source time, arrival index, and causal refs; several grants may share the client;
- `submit(findings)` — final IDs, with event IDs requested as evidence.

The adapter projects only native or deterministic derived facts. It does not invent authorization, provenance, access, or completion. The model sees no evaluator key, internal role names, seed, family, positive count, or answer-correlated ID prefix. A missing decisive source fact makes the incident invalid at construction; the frozen scored cohort contains complete evidence. V13 makes no unresolved-case claim.

## Counterfactuals and shortcut screen

Every incident contains an approved same-user survivor that reaches the protected resource. Unauthorized grants can be revoked or can have no protected call. A base-policy grant can be approved without a special registry row. Same-client grants can differ in authorization, preventing a client-name rule. The positive and benign same-client pairs each contain two grants, three token events, and two protected calls from distinct tokens; only the call-to-token-to-grant path identifies which grant accessed the resource. Registry rows include complete approvals and near misses with matching client but wrong scope, route, principal, tenant, or validity. Both authorized and unauthorized grants can have the same number of rows. Zero-positive incidents require an empty answer. Source times, event order, grant counts, and selector forms vary by seed and family.

Before calibration, run literal/prefix, row-count, survival, event-presence, client-presence, call-count, token-count, distinct-cause-count, and first/last baselines on the **frozen scored episodes**. The reference must flip when token→call cause, grant lineage, reset revocation, call time, or a decisive approval predicate is changed. These projected mutations test the decision logic, but they do **not** count as new native scored variants.

## Claim and calibration limit

The intended claim is limited to interactive investigation of synthetic F4 consent incidents under this published policy. It does not imply production SOC performance or safe enterprise deployment. A floor claim for Astra requires a frozen prompt/corpus/scorer/model interface, predeclared attempt unit and threshold, multiple independent attempts, valid provider responses, and no score-driven change to the scored cohort. If Astra solves the task, report that capability honestly.
