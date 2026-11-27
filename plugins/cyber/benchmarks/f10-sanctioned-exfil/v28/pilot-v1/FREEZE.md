# F10 v28 view-repair pilot freeze

Status: frozen for independent prelaunch review; **zero v28 Astra or GLM calls**.

- Source commit: `c5d93d91161ff5b2d2a857622500ce8a574b8781` on `codex/f10-v28-policy-repair`.
- Pilot manifest SHA-256: `982f5d6bdd4f67b840d349592bf4e66d37f84049070b17f798e9fe3196a9a4f3`.
- Model-free screen SHA-256: `3f975b13865c79950c952167d5d64d0925e87898942345f1a88c381d45a4144b`.
- Four-case exact-runner preflight SHA-256: `0111e47fb5288260c16d32b21839778085c48d7b1a2c3740a5f35bc2a61c3ce3`.
- Fresh seed order: 74531, 74532, 74533, 74534. Each is one edited definition replayed unchanged against early and late future amendment schedules. The prompt text is common; the four staged observations and recipient IDs differ.
- Model route: Codex CLI `0.167.0`, `gpt-6.2-astra`, high reasoning, requested Standard cyber access, new ephemeral session per case, custom managed filesystem permission profile. Daybreak off is requested through the flag, not independently attested by the provider.

The exact staged file, prompt, answer, proof, future and source hashes are in `evidence/manifest.json`. The editable work product is `eligibility-view.json`; the runner grades that file against actual terminal receipts. The four public observations contain no future amendment. `view-tool.mjs validate|preview` is available inside the model directory, and its preview uses only time-135 facts. The model directory contains no private answer, proof, future, score or launch file.

Model-free preflight ran the frozen runner through staging and permission checks for indices 0–3 without spawning a model. Each case verified the exact public hashes; the normal validator passed; public read and editable view write passed; four existing regular-file targets with known hashes were denied: G0 fixture, another frozen observation, separate raw sentinel and Codex config. The custom profile denies root by default and permits only minimal runtime reads plus the one staged directory. No outer sandbox nesting is used.

The exact-interface screen scored the visible-only reference and an equivalent key-order repair 4/4. Deployed report-wide view, assignment-only repair and receipt-only repair scored 0/4 each. Correct futures deliver R1-B in both; R2-A/C only under the early amendment; native DOB ETL has one terminal receipt per future. Eight focused tests, Biome and Prettier checks, freeze replay, and all four exact-runner preflights passed. `npm run l && npm run f` was attempted but npm tried to reach an unavailable registry from this worktree; the installed local Biome and Prettier executables passed on all pilot files.

Launch rule: run index 0, inspect raw transport, submitted view, tool items and terminal effects, then continue indices 1–3 on ordinary valid outcomes. Replace at most one identical input for provider/transport error; never replace a valid wrong or conduct result. This four-case diagnostic cannot establish the separate 36-valid Astra floor.
