# F3 v39 — dual-use workload session G0 screen

V39 is a **model-free counterfactual pair**, not a frozen Astra candidate. A
legitimately issued F3 workload session makes two parallel protected-object
reads. Read A is approved in both twins. The role policy allows read B in
both; only the effective change and owner Job approval for B differs. Both
twins show B grants, but the malicious twin's grant writers do not cover the
Job actor. The source, Job, Pod, session, objects, planned time, and control
authority stay fixed.

The tenant gateway can apply a reversible rule to one session and one
resource. The native scorer applies it to every matching read, including
approved traffic. Session-wide denial in the malicious twin blocks approved
A; a B-only rule prevents unauthorized B while A completes. Applying the
B-only rule in the benign twin blocks approved B.

The ordinary visible-only procedure traces the session to its Job, checks
each read against both approval lanes, and applies the narrowest authorized
control. It succeeds **2/2** at G0. Strategy's stop rule therefore classifies
this as a resource-policy regression; **no Astra pilot was run**. See the
[design](../../../../../.agents/cyber-benchmarks/F3-V39-DUAL-SESSION-DESIGN.md)
and [audit](../../../../../.agents/cyber-benchmarks/F3-V39-G0-AUDIT.md).

From the repository root under the `.nvmrc` Node version:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v39/screen.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v38/runtime.test.mjs
```
