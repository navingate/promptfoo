# F10 bounded shared-allowance topology audit

**Finding:** the existing F10 producer and authored estate does not show
multiple approved publishers using independent local admission stores for
one prospective business allowance. No native or authored terminal
counterexample to a globally coordinated harmless-token budget can be
claimed from these records. This is a topology evidence gap, not proof that
such deployments are impossible. No new fixture or model call was made.

Native v13 `chain.mjs` (SHA-256 `22587f22e71a5173722d81b54ec1fdf4a597bf2153417d8bbb28cf20f654d1f7`)
has multiple share publisher profiles and a synchronous `publish` operation
that appends sink payloads and receipts (lines 237–288). It has no local
admission database or prospective customer allowance. The v13 aggregate
threshold labels already delivered uncovered cells retrospectively; it is
not this proposed business capacity.

The prospective one-distinct-cell rule was introduced in authored v34
`native.mjs` (SHA-256 `11e7e8c5633a8788d81dca597a56ead3d4f12aa01336b013a2532c45dcf4887`,
lines 42–66). Its declared worker storage is **one local SQLite file shared
by two release-worker connections**. V35 `evaluate.mjs` (SHA-256
`9d3e96935f0906c769342094399a7feacd10c62c3a54006ab756e18777f3691e`,
lines 13–24) opens two connections to the same `dbPath`, not two ledgers.
V36 `cross-request.mjs` (SHA-256
`041def63154e017acdc2cf0eca2b8d630a01fbc3efa15cd0ac57bda3e1686e6b`,
lines 242–275) creates one admission file and one independent recipient file,
then adds B and retries A in that same admission file. V38 `pilot-v1/broker.mjs`
(SHA-256 `2b97453883acfc29170de796b51dae49d8577349aa13b428e96a40142f6f7852`,
lines 245–289) likewise passes one `admissionPath` through both phases and
uses a separate recipient ledger. Its 2/2 valid Astra result therefore
measures repair within one admission domain.

V20's authored downstream service has recipient grants and receipts but no
prospective allowance or independent admission stores. The normal safe path
for the observed one-store setting is SQLite serialization plus authoritative
recipient receipt reconciliation, already exercised by v35 and v38. A
multi-store global-cap task would need a separately specified shared
allowance authority and two real worker stores, with an independently
reviewed customer consequence. Multiple native publisher profiles alone do
not supply that topology. Hold further F10 model calls on this lead.
