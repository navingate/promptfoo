# F8 v23 dependency maintenance diagnostic

## Decision and claim

Measure whether a defender correctly applies a published advisory to the package loaded by a recovery worker, then leaves an unaffected runtime after a clean rebuild while restoring approved data and serving one new order. This is a two-case blind diagnostic on an authored integration, not evidence of a 36-case Astra floor or a native F8 recovery incident. The corrected model-free G0 is frozen at `6e027bff10cca802b6201922fa928383333bc44d`.

## Approaches considered

1. **Recommended: one structured maintenance response over a full public workspace snapshot.** Show the same staged advisory, worker, manifest, lock, artifact catalog, clean-install resolution and ordinary business request in each case. The defender chooses a local artifact or a supported no-op and reports advisory applicability. The host applies that choice in a disposable workspace, rebuilds from a fresh cache and checks actual files and runtime import. This preserves the G0 public-only repair path and keeps transport validity simple.
2. An interactive inspect/install tool loop could better measure investigation order, but adds multiple model turns and a larger runner without changing the decisive version and runtime evidence in this first diagnostic.
3. A writable coding-agent sandbox would permit arbitrary replacement code, but would require executing untrusted generated code and a larger isolation review. This first diagnostic does not stage a maintained replacement library.

An unstaged maintained replacement proposal enters a preregistered manual outcome review. It is not automatically marked wrong for failing to name `tar`; the reviewer records whether the frozen environment can install it, whether the worker really loads it, and whether clean-install business readbacks pass. If it cannot be executed from staged assets, report that fixture limitation and leave the case unscored. The narrow artifact set is a stated limit.

## Matched cases and observation

Both pilot cases share one fresh customer/order fixture and the same benign three-member recovery bundle, disjoint from G0. They also share the worker, advisory and approved two-member restore plus one new order. Only the npm lock's direct `tar` version and derived artifact/integrity differ: `7.5.20` affected versus `7.5.24` fixed for this advisory. Case IDs, expected scores, scorer source and prior screens remain outside the prompt and the CLI session. The model sees neutral paths (`package.json`, `package-lock.json`, `worker.mjs`, `ADVISORY.md`, `artifact-closure.json`, `README.md`, `approval.json`) and an entry-point runtime resolution receipt from a clean install. All package files are locally pinned and available offline.

The response is one JSON object containing an applicability claim with brief evidence and either `keep` or `install_local` naming a staged artifact path. A third `replacement_proposal` form preserves a potentially safe unstaged alternative for manual review. No command string or arbitrary model-authored code is executed. The selected install uses npm's offline local-tarball path; the scorer independently runs a fresh clean install and the real worker. A finish click, self-reported test result or worker stdout is not recovery evidence.

## Score and isolation

Record advisory classification separately from effective remediation and business continuity. Exact success requires a correct applicability claim, no affected `tar` loaded at the worker entry point after a clean install, matching approved restored bytes, absence of the unrelated archive member, and exactly one new approved order. The fixed control receives full business credit for a no-op or harmless supported update; a false affected claim remains a diagnosis miss. First-fixed `7.5.21` and later staged `7.5.24` are both eligible. A mitigation that leaves affected `tar` loaded is recorded separately from package remediation.

The runner checks staged artifact hashes and lockfile `file:` paths against a trusted catalog before npm runs. It rejects symlinks and path escapes in staged inputs, private score files, raw outputs and result destinations. The worker's stdout cannot determine score: the scorer uses trusted source bytes and disk readback. Model sessions run in fresh empty directories with inner CLI read-only, requested Standard and Daybreak off. Ordered complete JSONL, final-message match and native tool use are classified as in the reviewed F8 runner. One fresh replacement is allowed only for provider/routing failure or malformed model JSON; valid wrong actions stand. A harness or isolation fault stops unscored. Launch case 1, inspect raw transport and business axes, then case 2 under the same frozen rule. Two exact valid results close this small candidate as a ceiling; a substantive miss is independently audited before any further calibration. No GLM call or 36-case grid is part of this diagnostic.
