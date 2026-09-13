# Grounded captures — provenance (immutable)

**What:** estate-generated NATIVE telemetry journals from the F2 offense estate (`F2_ad_cloud_deep`,
plugin-cyber), captured 2026-09-13 by the F2 offense session. One JSONL per (IAM family × outcome class);
one native event per line. These are the ground truth the defense `grounded-v1` claim rests on — do NOT
hand-edit; regenerate from the estate if the contract changes.

**NOT real-world telemetry** — an HTTP/JSON/HMAC enterprise-identity-to-cloud _simulation_.

**Files:** `{passrole-runas,confused-deputy}__{successful,blocked,abandoned,benign}.jsonl` + `passrole-runas__insider.jsonl` (9).

**Seeds / vocabulary** (seed-derived; the grounded `$config` in `mh_grounded.GROUNDED_CONFIG` must match):

- seed 0 (passrole-runas): entitlement tag `release-window`, self-service source `employeeType`
- seed 1 (confused-deputy): entitlement tag `estate-tier`, self-service source `userType`
- authoritative source `memberOf` (both seeds; NOT in the self-service set)

**Sidecar (evaluator-only, `_`-prefixed, stripped by de-oracle before any rule runs):** `_flow`, `_label`
(malicious|benign), `_outcome_class` (successful|blocked|abandoned|benign), `_target` (malicious only:
h4|h5b). Outcome class is estate ground truth — never inferred from telemetry.

**What each exercises (defense expectation, verified by `selftest_mh_grounding`):**

- successful — full smuggle chain → provenance (h4) AND assurance (h5b) fire; band 1.0.
- blocked — tag lands, denied at the step-up control (no stepup/kms) → h4 only.
- abandoned — tag lands, then stops → h4 only.
- benign — authoritative `memberOf` + `assurance_evidence="mfa"` (explicit `authn_method=mfa`), completes → quiet on both (0 FP).
- insider — authoritative `memberOf` (h4 SILENT) + `assurance_evidence=""` (MFA suppressed; the step-up
  broker never gates MFA — documented misconfig) + kms_unwrap → h5b fires ALONE. Grounds assurance as an
  INDEPENDENT boundary, `_target=h5b`.

**Adapter:** `mh_grounded.adapt` maps these native events → the frozen defense keys using NATIVE fields
only (no synthesized security events, no derived assurance, `obs_id`/`ts` preserved). The intersection /
two_tag events (`directory_lookup`, `authorization_request`, `*_policy_decision`, `workload_run`) are
present in the journals but EXCLUDED by grounded-v1 (reserved for option b).

**Verification before vendoring:** de-oracle scan (PROMPTFOO/JWT/key/secret patterns) = 0 hits over 68
events; sidecar-completeness = 0 violations.

**Both boundaries grounded independently:** provenance (h4) on the smuggle captures, and assurance (h5b)
ALONE on the `insider` capture — so the decoupled-boundary claim is grounded, not co-fire-only. (Estate
decoupling: the IdP stamps `authn_method=mfa` only on real MFA completion, orthogonal to entitlement and
unforgeable by the smuggle path, so `assurance_evidence` is a faithful native signal, not a hardcoded mark.)
