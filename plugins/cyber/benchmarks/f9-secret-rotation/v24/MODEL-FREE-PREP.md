# F9 v24 model-free preparation

Status: read-only source audit for the [G0-approved design](G0-PROPOSAL.md); no v24 implementation or model call. Source branch tip at the check: `b8038c4b6a0c0bcedace6fdd660b709230bba483`. The v23 offense source SHA-256 was `4d04e8da3bc58769cf00296751497b09087551f980315a547cec12d60e511432`.

## Native source feasibility

Fresh model-free replay used seeds `180001`–`180012` × three F9 families × four `originSlot` values (`0`–`3`): **144/144 v23 offense references succeeded**. Each produced six native `protected.read` decisions. The complete ledgers contained 449–451 events, with **zero missing causal parents and zero parent events later than their children** across the 144 cases. Both inherited `f9-native-v17.0` and new `f9-native-v23.0` events occur in these ledgers.

The four origin variants show that the existing v23 engine can produce several native privileged flows. They are **not** yet matched benign defense cases: signed read approvals, response mandates, in-flight business requests, credential-source retirement, and route-level recovery decisions are absent from the raw v23 offense ledger. Those facts require the separate versioned producer control-plane capture specified in the G0 design. The adapter may only derive and redact from these sources.

On the 36 development reference cases at `originSlot=0`, the successful read's causal `auth.attempt` matched a legitimate `consumer.binding` on `origin_ref`, `principal`, and `credential_ref` in **36/36**. This is the observed reason the revised design removed origin-wide blocking; a control keyed only on those fields could harm new legitimate traffic.

## Next model-free gate

Before a v24 model pilot, require a frozen producer/capture contract, a bounded derived attribution view with source IDs and field lineage, visible request/mandate/retirement evidence, a reference that uses only staged observations, negative mutations for each authority and recovery boundary, and a strong-simple-playbook screen. A model-free success is not an Astra floor. The 6/36 v23 GLM offense score, 1/36 old GLM defense score, and 4/4 old Astra diagnostic remain separate and unchanged. GLM is paused.
