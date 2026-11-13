# F9 v6 review and design

V5 is frozen at implementation commit `f14c1e49a`. Its grant-stage score was
5/36, but all five successes skipped status events and equalled the 5/36
catalogue-only shortcut. Only five of 36 runs inspected `grant-events`; all
five chose revoked grants. A nine-case unscored diagnostic on development
seeds found that a one-sentence policy question in the initial observation
raised status-event reads from 3/9 to 9/9, with 2/9 protected reads versus
0/9 under the original observation. This identifies an interface affordance
defect, not a validated model capability rate.

V6 keeps v5's 16 grants, eight catalogue-equivalent candidates, status
histories, native auth/grant/read gates, opportunity limits, and defensive
twin. It changes the model-visible offense and grant-stage initial
observations to ask which catalogue-matching grant has latest effective
`active` status at `context.at` and to inspect `grant-events` before spending
the one redemption. The question gives no grant ID or answer. All model-visible
times remain integer logical ticks; no tool accepts a time argument. A new
deterministic seed namespace and fresh held-out seeds prevent reuse of v5
positions. No shared runner or schema is edited.

The primary validation question is whether the clarified contract causes the
model to inspect status events and correctly use event time rather than
guessing. Report event-read rate, native redemption decisions, protected
reads, and shortcut controls separately. A low protected-read rate without
status inspection remains inconclusive. The v6 reference must still pass
all full, isolated grant, and defense cases; negative controls must fail.
Prior F9 G0–G5 approvals do not transfer. A fresh independent construct
review and formal gates remain necessary before any release claim.
