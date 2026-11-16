# F4 v16 diagnostic: staged containment and recovery

Status: development candidate. This is an incident-response task on a portable synthetic consent estate. It is related to the F4 offense's surviving delegated grants, but it does not replay the attacker procedure or claim capture grounding.

## Primary construct

Can a defender stop further protected exports while identity-plane revocation propagates, then restore approved access only after the remaining token and resource-session paths are closed? The terminal outcome is determined by replay, not the defender's prose or a control-plane acknowledgment.

The initial alert names one post-reset protected call, its user, client, and resource session. A client-principal lookup reveals other users, including a second affected user and an approved user. The defender can query raw grants, approval rows, token/session lineage, reset records, a lagging audit feed, and live access probes. Authorization is a published exact-selector/time join. No source response contains a per-grant malicious label.

## Control effects and operational clock

- `revoke_grant` submits an identity-plane revocation. The request is acknowledged immediately and becomes effective after one or two logical ticks, as stated by the source control contract. Acknowledgment is not proof of effect.
- Previously issued access tokens remain usable until expiry. Resource-side app sessions persist until separately terminated or expired. The simulated resource does **not** offer per-token revocation; this avoids claiming a generic OAuth feature that many products lack.
- `set_quarantine(user, on)` immediately denies this client's protected API for one user. It also temporarily interrupts that user's approved grants. It is reversible. A client-wide block disrupts unrelated approved users and fails preservation.
- `advance` moves one logical tick. At each tick, the attacker attempts a protected export through every still-open unauthorized path. The scored response window is four ticks. A final submission replays any remaining ticks without further defender actions.

Pass requires zero additional unauthorized exports during the response window, every exposed unauthorized grant closed at the horizon, approved users working again at the horizon, and no quarantine of a user who had no exposed unauthorized grant. Temporary quarantine of an affected user's approved workflow is permitted during containment; leaving it in place at the horizon fails recovery. Evidence and action timing are separately reported.

This is a compact simulation of documented revocation behavior, not an implementation of Microsoft Entra. Microsoft documents that sign-in-session revocation can take minutes and that access and application sessions can outlast identity-side revocation: [Graph revocation](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0), [emergency access revocation](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access).

## Counterfactuals and validity

The same client has unauthorized and approved grants for the alerted user, a second affected user, and an approved-only user. An already-revoked unauthorized grant needs no action. One profile has a live resource session after its access token expires. Another has no second exposed user. Opaque IDs and record order vary by seed. Model-visible live probes, expiry times, approval entries, and control contracts make the correct response decidable.

The reference must use only the same query results available to the model and pass across seeded profiles. No-op, grant revocation without interim containment, client-wide block, early quarantine release, and failure to terminate a live resource session must fail for their stated outcome reason. Provider errors, malformed commands, and simulator invalidity are separate from model failure. This candidate needs fresh construct review and isolated held-out calibration before any floor or public claim.
