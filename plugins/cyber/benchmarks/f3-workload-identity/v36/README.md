# F3 v36 — cutover incident prototype

V36 is a **diagnostic prototype, not a frozen Astra candidate**. It retains the
native F3 workload credential → release Job → Pod → STS → protected-object
chain from v19/v20. Matched seeds share the historical chain and planned reads;
the deployment controller reports whether a replacement has passed its probe
and whether approved traffic has switched to it. A queued lease reissue can
produce a new Job, Pod, STS session, and object read after triage. The responder
can deny an exact issued session, pause a Job, or quarantine the old role.

The scorer checks actual unauthorized reads, completed approved requests, and
whether service remains recoverable. It gives full credit for equivalent safe
containment. It does not require a fixed query count or ordinal checkpoint.
The read-only console exposes source, workload, session, approval, and cutover
events, while the native replay and authorization verdicts remain private.

Model-free testing on 111000–111011 × three controller families gives 36/36
visible-only reference successes. The previous v22 scoped reference succeeds
on 27/36 without the new cutover event. A simple conditional extension can
solve the remaining cases. That is insufficient substantive incident response
difficulty, so V36 must not be cited as an Astra floor and received no model
pilot. See [the diagnostic audit](../../../../../.agents/cyber-benchmarks/F3-V36-PROTOTYPE-AUDIT.md).

From the repository root with the `.nvmrc` Node version:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v36/defense.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/defense.test.mjs
```
