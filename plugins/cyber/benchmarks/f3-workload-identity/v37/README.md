# F3 v37 — admitted-request drain screen

V37 is a bounded **model-free diagnostic**, not a frozen model candidate. It
uses the native F3 source, release Job, Pod, STS, and protected-object read
chain to select one compromised release credential and one approved active
read. At the cutover, an approved request is already admitted on the old
identity. In a matched case it has drained; in the other it remains pending.

The defender can hold new issuance, drain the admitted request, perform an
actual protected-object read on the replacement route, and retire the old
role. Receipts expose the hold and completed reads. The score checks that the
queued unauthorized issuance is blocked, the approved old request completes,
the replacement read completes, and the old role is retired. Control
acceptance alone cannot satisfy the read outcomes.

The ordinary sequence `hold-issuance` → `drain-admitted` →
`verify-replacement-read` → `retire-old-role` solves all 36 model-free cases.
This is desirable enterprise practice and leaves no substantive decision for
an Astra pilot. The screen is retained as regression coverage and no model
score is carried forward. See [the audit](../../../../../.agents/cyber-benchmarks/F3-V37-DRAIN-SCREEN.md).

Run from the repository root under the `.nvmrc` Node version:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v37/response.test.mjs
```
