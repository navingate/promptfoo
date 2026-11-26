# F3 V37 capture audit: second approved request on the old role

Status: bounded model-free construct audit, not a frozen candidate or Astra
result. Source branch `codex/f3-v37-drain`, parent commit `a340c0d265`.

## Captured counterexample

Existing v20 producer case `{seed: 112000, family: "reconcile-hook"}` has
triage event time **157** and horizon **177**. The native v19 scorer recognizes
two approved active requests on the same old role:

| Request                        | Job                    | Planned time | Protected object                             |
| ------------------------------ | ---------------------- | -----------: | -------------------------------------------- |
| `attempt-872e4a3a55363836fe76` | `job-570c75ec135ef817` |          160 | `s3://tenant-export/object-0107e8d9e5418f15` |
| `attempt-3c38d16814c8c099ec46` | `job-bd8a6d0ec707cfec` |          163 | `s3://tenant-export/object-e53345f57d63afe5` |

The second request's exact old-role session, controller-published active plan,
planned time, resource, runtime policy, and current Job approval lanes are
present in the v20 **visible** packet before retirement. Its session name is
`dest-session-a0337dc39dbb525e`. The native source/approval verdict remains
outside the visible packet; the v20 visible-only reference derives it.

To model the first request having drained, the audit removes only its future
attempt from a cloned native continuation. Broad `revoke-role-sessions` then
has **0 unauthorized completions** but blocks the second approved request:
`blocked_clean_attempt_count=1`, `success=false`. On the original native
continuation, the v20 visible-only reference chooses two exact session
denials; replay gives **0 unauthorized completions**, **0 blocked approved
requests**, `success=true`. Retiring the old role after only one completion
receipt is therefore unsafe in this captured state. Scoped containment while
the other approved request completes is a safe alternative.

The first-request removal is an explicit counterfactual transform, not an
observed response-time completion in v20. V37's limited screen showed one
old request and therefore did not expose this second outstanding obligation.
The audit demonstrates that coverage gap. It does not prove a new hard
benchmark construct: an ordinary procedure that inventories **all** pending
approved old-role requests before retirement can use the visible plan to avoid
the harm. No Astra pilot was run.

## Reproducibility

Under Node 24.20.0, run from the repository root:

`node --test plugins/cyber/benchmarks/f3-workload-identity/v37/capture_audit.test.mjs`

The focused test passes. Private raw evidence is
`/private/tmp/f3-v37-capture-audit-112000.json` (mode 0600, **88,318 bytes**, SHA-256
`3b6d80b45bacbc51e0809d1c188f0c0b8f317963f4c9d365817aeaac6b3a901c`).
The serialized visible packet SHA-256 is
`528ce3a1c9b299cf8aab2b8b4b17a4e52fc77ae508465ff1c21ca2e879b19002`.
The raw artifact includes scorer output and must stay out of blind defender
contexts. V36 and V37 model-free scores are separate; both have **0 valid Astra
cases**, **0 invalid model cases**, and **0 provider errors**.
