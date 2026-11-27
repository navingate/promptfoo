# Scan-action release history: bounded F10 feasibility check

**Decision: close this lead at read-only feasibility.** The public release
chain supports a real independent-lockfile maintenance problem, but this
check found no demonstrated F10 authorized publication or DOB ETL outcome
from the distributed code-scan action. No new fixture, G0 score or Astra/GLM
call was made.

[Promptfoo PR #10278](https://github.com/promptfoo/promptfoo/pull/10278)
shows that the root `undici` floor had already moved to 7.29.0 while
`code-scan-action/package-lock.json` still resolved 7.28.0. The PR changes
the action's override and lock to 7.29.0. At the PR's base commit
`64de019db865cb78474da7c514c2bba37e3d0bcc`, the action's
[`package.json`](https://github.com/promptfoo/promptfoo/blob/64de019db865cb78474da7c514c2bba37e3d0bcc/code-scan-action/package.json)
has its own `undici` override. Its
[`release-please.yml`](https://github.com/promptfoo/promptfoo/blob/64de019db865cb78474da7c514c2bba37e3d0bcc/.github/workflows/release-please.yml)
performs a separate `npm ci` in `code-scan-action/`, builds `dist/index.js`
with esbuild, and mirrors that bundle as the action entry point. Root-only
dependency repair therefore does not establish the action's release graph.
[PR #10292](https://github.com/promptfoo/promptfoo/pull/10292) subsequently
added nested-installation drift checks.

The public mirror has a before/after artifact pair, but it is **not** a
published root-only versus action-lock repair pair from the exact #10278
base. Release
[`v0.1.8`](https://github.com/promptfoo/code-scan-action/commit/148e01f35bc65bd992b9f44679577aa9123be6ab)
on June 16 points to source `af7ec0b5f1072685a919015faf5799cc0886d71e`;
that [source action lock](https://github.com/promptfoo/promptfoo/blob/af7ec0b5f1072685a919015faf5799cc0886d71e/code-scan-action/package-lock.json)
resolves `undici@7.25.0`. Release
[`v0.2.0`](https://github.com/promptfoo/code-scan-action/commit/104214d969d978d545e6ddf3c8a6fec911f16626)
on August 28 points to source `2c45764ca1daf4587c83d68b940ba0eb14cb7ac4`;
its [action lock](https://github.com/promptfoo/promptfoo/blob/2c45764ca1daf4587c83d68b940ba0eb14cb7ac4/code-scan-action/package-lock.json)
resolves 7.29.0 and its changelog includes #10278 among
other changes. The public `dist/index.js` blobs at those mirror commits are
1,856,068 and 1,902,129 bytes, respectively. Local copies SHA-256 to
`dfaa683013d457419f4246a9a17892fab6da368072fc2bd6e90857af7c67ac03`
and `8921d02aed5f4e25ffc1dff1fb09bbfa973b5d047ac729acaffc6f846026427d`.
Both pass `node --check` and contain 112 bundled `node_modules/undici/`
module headers. The source commit, action lock, release workflow and mirror
provenance support a shipped dependency transition; the bundle does not
embed a simple package-version literal that independently identifies its
`undici` version.

The [maintainer advisory](https://github.com/nodejs/undici/security/advisories/GHSA-4cwx-7wf7-3272)
lists `undici` 7.0.0 through versions below 7.29.0 as affected and 7.29.0
as patched. Its disclosed cache problem requires the shared cache
interceptor or the relevant mixed-directive parser path. The release graph
establishes an affected **package version**, not that the code-scan action
used that vulnerable API or exposed customer data. No exploit was run.

The action's [`action.yml`](https://github.com/promptfoo/promptfoo/blob/64de019db865cb78474da7c514c2bba37e3d0bcc/code-scan-action/action.yml)
points at `dist/index.js`, but the available
[`main.test.ts`](https://github.com/promptfoo/promptfoo/blob/64de019db865cb78474da7c514c2bba37e3d0bcc/test/code-scan-action/main.test.ts)
mocks `@actions/core`, `@actions/github`, subprocesses and filesystem
operations against source `main.ts`. It is not a benign execution of either
published bundle with an observed completed customer scan. The mirror
release pair also spans unrelated action changes, so it cannot isolate a
root-only-repair terminal effect. A future separate task would need an
isolated historical build plus a normal, non-secret action integration
check that records a real approved scan outcome. Transplanting the worker
into F10 would be a new authored publication service, repeating the
dependency-resolution capability already solved in v41/v43 unless a
distinct customer delivery consequence is proven first.
