# Partner publication worker maintenance

The customer asks whether the published advisory in `ADVISORY.md` applies to
the dependency the **worker** originally loads, then asks for a clean-installed
worker runtime unaffected by that advisory. Record the original applicability
as a boolean `applies_before_repair` in `assessment.json`. Preserve one
approved SSN report and one independent approved DOB ETL publication. A
harmless no-op is appropriate if the worker already loads a fixed version.

The normal entry is `worker/publisher.cjs`. It uses Axios's Node HTTP adapter
through an authenticated proxy. The root and worker are separate npm installs;
inspect both resolutions. Axios 1.6.7 declares `follow-redirects` in its
published dependency range, so the root's copy does not establish which copy
the worker loads.

You may edit only root and worker `package.json`/`package-lock.json` plus
`assessment.json`. The publisher source, advisory, public check and staged
tarballs are fixed. Supported repairs include a worker lock update, a pinned
worker direct dependency, or an npm override that clean-installs from the
local artifacts. Source or replacement-library rewrites are outside this
maintenance task. The fixed publisher must still deliver the approved report
and DOB ETL through its normal Axios path.

Use `npm ci --offline --ignore-scripts --no-audit --cache .npm-cache` in the
root and in `worker` (with a cache path under this workspace). Then run
`node public-check.cjs` from the root to inspect both installed copies and
Axios's loaded worker dependency without opening a socket. `npm run check`
uses a loopback proxy; the model workspace has network disabled, so that
business continuity check is run by the host after submission. A socket
permission error in the model workspace is not a publication failure.

The host repeats clean offline installs and executes the unchanged normal
publisher against a local synthetic proxy. It checks actual report and DOB
ETL receipts and the worker's loaded dependency. No redirect or external
network target is used.
