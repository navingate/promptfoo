# F3 defense v13 — combined native provenance paths

Status: working design after independent Astra review; the user authorized
this iteration. Formal construct approval, implementation, and model
calibration remain pending. V12 remains a frozen
failed floor screen (8 exact in 10 valid cases, preregistered stop).

## Decision and scope

The detector still writes one reusable data-only rule for a hidden
six-incident batch. Its decision is whether the release bearer led to an
unauthorized source read, an unauthorized production Job read, both, or an
approved automation. It must return the native source-fetch and Job-read
proof IDs (the existing `source_read_event_id` field names the source fetch).
The four pressures below coexist in each v13 world. They add no new service,
product, external data source, scored label, or model-facing event kind.

1. **Shared source credential, distinct mappings.** A controller uses the
   same store credential for a legitimate operational secret mapping and
   the release-secret mapping. Both native fetches complete, have the same
   credential ID, and have distinct object UIDs and remote references. The
   release token's credential reference identifies its mapping. The
   operational mapping has its own native write, reconcile, fetch, and
   authorization evidence; it is not a fabricated log row.
2. **Stale and current source revisions.** The release mapping is reconciled
   at revision 1, then legitimately patched and reconciled at revision 2.
   Both fetches complete; the synced secret read that supplies the redeemed
   bearer is from revision 2. The source producer and independent analyzer
   bind the scored fetch to the actual synced read by object UID, revision,
   credential ID/version, and resource. We do not duplicate a completed
   same-revision reconcile, because its current write-based causal reference
   would make two histories observationally identical.
3. **Same-session Job reads.** Keep v12's separately authorized operational
   object read under the same destination role session and access key as the
   protected read. The submitted resource and native Job read ledger select
   the protected read. This pressure is already solved by GLM-5.3 in v12;
   it remains a realistic neighboring operation, not a claimed new floor.
4. **Runtime credential renewal.** During one admitted Job run, the Pod
   obtains a second, legitimately issued runtime credential, web identity
   session, and destination role session. Both paths have distinct native
   request, session, and access-key references; only the renewed destination
   session performs the protected read. The first path is a completed unused
   session, not a denied decoy. The run ledger links its protected read to
   the active session.

The old v10 interpreter cannot express the fourth pressure: it rejects an
ambiguous early `request` before later events can resolve the path. V13
therefore evaluates all bounded complete paths for each release redemption
and requires one unique final `(source-read proof, Job-read proof, label)`
tuple. Distinct internal paths with the same output tuple are harmless;
conflicting proof or label tuples fail as ambiguous. The rule syntax,
model-visible fields, authorization semantics, and v10–v12 interpreter
behavior remain unchanged. V13's guide describes whole-path matching.

## Evidence boundary and counterfactuals

Every added event must come from the native producer and retain actor,
resource, event time, arrival order, causal reference, outcome, and policy or
grant snapshot lineage. No evaluator label or authorization verdict is
injected into the visible projection. The model sees only training-world
events, grants, membership audit, and existing policy snapshots; it cannot
query the hidden world.

The authorized and malicious incidents continue to use the same controller,
store, release token, Job, Pod, STS, and protected-object operations. Native
authorization truth is evaluated at the actual selected source and Job read
times. Completed group membership transitions can fall between competing
reads; a wrong read can therefore change the label as well as the proof.
The operational source fetch and Job read are context, not separate scored
incidents or per-read false alarms.

## Model-free gates before calibration

- The v13 reference rule is exact on separate development and holdout grids
  in all three controller families. The independent native analyzer agrees
  with labels and both proof IDs. V9–v12 behavior and offense self-tests stay
  unchanged.
- Disable each pressure separately and verify the other three remain native
  and solvable. In the combined world, a rule lacking each decisive source
  resource, source revision, active role path, or Job resource link must fail
  for the corresponding ambiguity or wrong proof. The full reference rule
  survives all four together.
- There are no same-revision equivalent completed reconciles, no
  grader-only source-read selection, no event-count or fixed-position label
  shortcut, and no unbounded path enumeration. Report label errors separately
  from null labels caused by ambiguous paths.
- Freeze source hash, fixed fresh scored seeds, exact Cloudflare GLM-5.3
  settings, pilot, and futility stop before any v13 model call. The target
  remains at most 7/36 exact with at least 30/36 valid parsed rules and no
  provider/model-echo error. A failed threshold or validity gate is reported
  plainly, without tuning on scored seeds.

This candidate can support only a narrow synthetic F3 detection claim. Its
four pressures do not themselves establish a GLM-5.3 floor, transfer to real
Kubernetes/AWS logs, or enterprise deployment safety.
