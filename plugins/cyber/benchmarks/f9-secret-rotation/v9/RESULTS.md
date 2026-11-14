# F9 v9 pre-call evidence

Status: **transport-only candidate; no v9 model calls**. The frozen v8 screen halted on a transient `TypeError` at its first scored offense case after one excluded valid pilot. Its assigned 36 offense cases yielded 1 attempted, 0 valid scored, and 1 provider error. Defense and isolated grant stage were not attempted. V8 raw captures and hashes remain in `../v8/RESULTS.md`; no v8 result is pooled here.

V9 uses untouched fresh seed blocks `25001`–`25012` and excluded pilot `24901`. The imported v8 core has 40/40 focused tests passing. On the v9 seeds, model-free references pass **36/36** offense, **36/36** isolated grant stage, and **36/36** defense (9/9 per subtype). Fully staged context passes **36/36**. The private audit is `/tmp/f9-v9-precall-audit.json`, SHA-256 `67d4a2bdda981d471e74d6376057ba0aa5fea118e7b51f51cd078d37562ae608`.

Structural controls on these seeds: first-route **3/36**, retrospective best fixed route **3/36**; single-signal migration **4/36**, lineage **4/36**, lease **10/36**; migration plus lease **18/36**, lineage plus lease **15/36**, static migration plus lineage **16/36**. Isolated grant first position **0/36** and retrospective best fixed grant **5/36**. Best fixed controls are posthoc envelopes. These are model-free figures, not model outcomes.

The retry wrapper's focused tests cover identical-body TypeError and 429 retries, pacing, 7-attempt exhaustion, no retry for other errors, and wall-limit halt. Integration tests cover fresh grid assignment, private mode-0600 checkpoint, unchanged low/16k request body on seven 429 attempts, and seven-TypeError provider halt. **48/48** focused tests pass (40 frozen-core and 8 v9). Targeted Biome and Prettier checks pass with one nonfatal cognitive-complexity warning in the retry function. The repository `npm run l && npm run f` scripts could not inspect changed files because their `git diff origin/main` query attempted to fetch a missing promisor object while GitHub DNS was unavailable; targeted file checks were run with the installed tools.

V9 source commit: `ac1254605`. SHA-256: wrapper `353ba97d07fecb4a6324326dd542afe363149b6d9df922968ca95a5b14f1fef1`; transport `1491fdadf68bec4167d8f47d7d1edb526139b85fbe3942faf7532adb50aa1d4e`; wrapper tests `170fcdc229430e595491161277614c5cc7c5011ab9a4b597e76ee75776a679ee`; transport tests `7f7a495fe4a354940d0d5f29e84d5341ad81db22b5eb440989f240b937a7378d`.

A credential-free DNS resolution and HTTPS HEAD request to the public Cloudflare API host succeeded at preparation time. This does not establish the cause of v8's transient failure. No credential or model request was used for that check.

No v9 model performance, capability floor, G0–G7 approval, product fidelity, or deployment claim follows from this evidence. Live screening is held until the shared model slot is released.
