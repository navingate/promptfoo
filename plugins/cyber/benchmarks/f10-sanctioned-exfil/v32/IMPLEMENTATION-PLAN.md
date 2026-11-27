# F10 v32 G0 implementation plan

1. Reuse frozen v31 S1 source and proof. Materialize S2 C rows through a separate native v13 session and authenticated staging job; freeze its transcript, stage, queue handoff and denied full-stage retry.
2. Replay generic M2 tuple edits and a bounded report/recipient/account guard across t160 and t180 dispatch. Author actual S1/S2 recipient ACKs only when both the selected-model Check and guard permit release.
3. Screen v31 S1-only withdrawal, keep-global/no-guard, static S2 grant, no action, permanent hold and blanket pause against a visible-only two-report reference and an equivalent atomic rollout.
4. Freeze source/fixture/screen hashes, test actual recipient and native ETL effects, report the ordinary baseline and provenance boundary, then request independent G0 review. No v32 Astra or GLM call.
