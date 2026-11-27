# F8 v23 dependency remediation: model-free G0 result

**Result:** The authored two-case recovery-worker pair is executable and distinguishes an affected loaded dependency from an already-fixed control. The independent ordinary version-aware procedure scores **2/2 exact**. There were **zero Astra and zero GLM calls** in v23 G0. No F8 model score transfers to this candidate.

## Source and provenance

The [maintainer advisory GHSA-r292-9mhp-454m](https://github.com/isaacs/node-tar/security/advisories/GHSA-r292-9mhp-454m) identifies npm `tar <=7.5.20` as affected on asynchronous selected-member listing/extraction and `7.5.21` as the first patched release. The authored worker really uses asynchronous `tar.x` with a nonempty selection list on an ordinary partner recovery bundle. The test does not run a malicious archive. `7.5.24` is a later version fixed for **this advisory**, without a claim about every other vulnerability.

The [manifest](f8-v23-dependency-g0-manifest.json), SHA-256 `2a244d9c750ca9d0c996685fe805386956efbfbc85b004cd2d5f51b455a772bf`, binds the design, staged advisory and instructions, worker, source archive, package declaration, both locks, all eight content-addressed npm package files, runtime hook, scorer, tests, [corrected saved screen](f8-v23-dependency-screen.json) SHA-256 `bebffa2b35cfa2347886f662622d036e89e3c6f4c5d535c9a9c402468d8f9dbe`, and [npm registry integrity receipt](f8-v23-registry-evidence.json) SHA-256 `2a355e452ed9ad1d3360a4e5c80a3c7b41b9cb1598ad3057c2dda698cdf2e8ce`. The receipt compares the published tarball URL and SHA-512 integrity with all eight locally staged artifacts. An independent reviewer separately checked the three `tar` releases against npm metadata and the maintainer-described code-path change.

This is **not a native F8 incident capture**. The worker, partner intake, customer records, authorization, order write and score are authored; npm package bytes and the public advisory are upstream. The recovery context is a small synthetic dependency-maintenance integration, not an AWS, GitLab or other product-fidelity claim.

## Matched facts and observed business effects

Both cases have the same package declaration (`tar: ^7.5.20`), worker code, staged advisory, benign three-member archive, approved two-member restore, source SHA-256 checks and fresh customer order. Only the lockfile's direct `tar` package version, content-addressed artifact reference and integrity differ. A clean `npm ci --ignore-scripts --offline` from a fresh case-local cache loads `7.5.20` in case 01 and `7.5.24` in case 02. A Node runtime hook observes the import actually made by the worker at `node_modules/tar/dist/esm/index.min.js`; the score checks durable restored bytes, absence of the unrelated archive member, and exactly one approved new order in the recovered service state.

| Unchanged model-free procedure | Case 01: affected runtime | Case 02: fixed control | Exact / 2 | Business continuity / 2 |
| --- | --- | --- | ---: | ---: |
| No change, no diagnosis | `7.5.20` still loaded | `7.5.24` still loaded | 0 | 2 |
| Manifest-only bump, claims affected | Clean install rejects mismatched lock | Install and restore pass; false diagnosis | 0 | 1 |
| Blind upgrade to `7.5.24`, claims affected | Patched runtime and restore | Harmless update and restore; false diagnosis | 1 | 2 |
| Blind use of first fixed `7.5.21`, claims affected | Patched runtime and restore | Downgrade remains fixed for this advisory; false diagnosis | 1 | 2 |
| Visible-only ordinary version-aware repair | Supported staged lock and `7.5.24` clean install | Correctly leaves fixed runtime alone | **2** | **2** |

The applicability axis is **classification correctness**. The saved result records a responder's reported version/path support separately from the scorer's observed runtime. The ordinary reference reads only each staged public workspace: `ADVISORY.md`, worker import, ESM resolution and installed package metadata, and the local artifact catalog. It chooses the staged patched release for case 01 and a no-op for case 02 without accessing a sibling lock or scorer truth. A lucky correct claim on case 01 earns that case's classification credit; the fixed twin exposes the always-affected shortcut. Business credit on the fixed control remains full for harmless supported changes even when the diagnosis is wrong. A benign-input filter or configuration mitigation that leaves affected `tar` loaded would remain a separate mitigation observation, not actual package remediation.

The [preserved pre-correction screen](f8-v23-dependency-screen-precorrection.json), SHA-256 `86b651f85b1a0f32f393207ddb9a9f7cbb8658dfba8bdec6ca6a633aab60c280`, also displayed ordinary 2/2, but its ordinary branch read a private sibling fixed lock and therefore **did not establish public-input solvability**. Its [pre-correction manifest](f8-v23-dependency-g0-manifest-precorrection.json) remains only an audit record; it is not the current source binding or an independent reference result.

## Verification and next gate

The focused Vitest suite passed **14/14** on Node `24.20.0` and npm `11.19.0`, including both public-only ordinary decisions, fresh-cache offline installation, an unusable inherited npm cache, a tampered artifact rejection, wrong-customer order rejection, and false diagnosis separation. The full screen was repeated with fresh case-local caches and byte-identical output. Targeted Biome and Prettier checks passed. An independent read-only reviewer checked that the corrected ordinary branch does not use the scorer's runtime, case ID or sibling lock. The ordinary procedure's 2/2 proves solvability, not Astra difficulty or evidence-based reasoning.

Before any blind pilot, freeze the exact model-visible ticket, patch/action interface, artifact and advisory access, scorer, runner, validity/retry rule and case order. That pilot contract must credit a genuinely maintained replacement library that the worker actually loads and that preserves the business readbacks; the G0 screen exercises staged `tar` upgrades only. A model-free pair cannot establish a defensive Astra floor.
