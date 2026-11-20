# F4 v18 response: aggregate live probe amendment

Status: approved by the user on 2026-11-20 after independent G0 construct review. No defense model has seen v18, and no scored defense request has been made.

## Why this amendment is needed

The approved reference limit is 40 model turns and 56 tool actions, with one native function call per turn. Each affected user in the twelve both-live incidents has three unauthorized grants and one approved grant. The current release evidence rule requires live states for every unauthorized grant before release and for every unauthorized and approved grant after release. With only `probe({grant_id})`, required reads, controls, advances, release and final probes, delivery reads, and submission exceed 40 calls. This is an interface budget defect, not a model failure. The required evidence and 40-turn limit remain in force.

## Proposed tool and evidence contract

Add the read-only `probe_user({user_id})` tool. It returns one native live state for **every grant belonging to that client principal**:

```json
{
  "user_id": "...",
  "observation_tick": 1,
  "grants": [
    {
      "grant_id": "...",
      "observation_tick": 1,
      "can_mint": false,
      "live_token_ids": [],
      "live_session_ids": [],
      "quarantined": true,
      "client_blocked": false,
      "protected_access_allowed": false
    }
  ]
}
```

Each row is the existing `accessState` for that grant at the query tick. The tool returns no authorization verdict, target count, hidden lag, expected assignment, safety label, or release advice. Preserve the existing `probe({grant_id})` tool. The aggregate response is native engine feedback, subject to the same action budget, ledger replay, and model-visible observation scan as every other tool result.

The scorer may use a successful aggregate row as live evidence for that grant, at that invocation index. Native replay must verify complete, unique rows for the user's grants and require every row's tick to equal the outer observation tick and ledger tick. A missing, duplicate, wrong-user, or wrong-tick row invalidates the native run; it is not a model evidence failure. The existing requirements remain: before release, every unauthorized grant of that user has `can_mint=false`, no live token, and no live session; after release, unauthorized grants are denied and approved grants remain usable; after the last relevant control or advance, every exposed path has a tick-4 live probe; approved jobs have post-due delivery reads. A quarantine-level `protected_access_allowed=false` alone is insufficient. Single-grant probes continue to count as evidence under the same rules.

## Reference budget and fairness gates

The worst both-live sequence is estimated at 39 calls: 13 source reads across all principals, 9 controls, 4 advances, 1 dashboard read, 8 aggregate probes, 3 delivery reads, and 1 submission. A null reset read for the approved-only user makes 40. The reference will use source token, session, grant, and reset records to choose immediate tick-0 controls, then live feedback at tick 1, tick 2, tick 3, and tick 4. It will not need a tick-0 live probe or repeated probes of the released fast user at ticks 2 and 3. These are estimates to verify in executable tests over all 36 cases and 12 swapped-lag clones; any case above 40 fails the gate.

Before freezing the interface, test that response row order and count add no target or hidden-lag signal beyond already visible grant ownership; grant/call presence, structural counts, ID, position, expiry, deadline, and dashboard-only shortcuts still fail for causal reasons. Swapped-lag twins retain byte-identical pre-tick-1 visible facts, including `probe_user` output if called before tick 1. At tick 1, the lower-authority dashboard may assert effective revocation while a slow grant's aggregate row reports `can_mint=true`; the live row governs current capability. Scan the complete model-visible plane, including every aggregate response. Any source-validity, reference, or shortcut failure requires another reviewed revision before model use.

## Decision

This amendment changes the tool interface and evidence packaging before calibration. It does not change the native attacker schedule, authorization join, action effects, outcome scorer, model or reference budgets, case matrix, or operational floor. Independent construct review and user approval are complete. Implementation must still pass the executable reference, shortcut, observation, and interface gates before model use.
