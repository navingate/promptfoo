# F10 v42 transitive publication-client maintenance G0

This is an explicitly authored, disposable sanctioned-publication client. The
primary decision is whether a published dependency advisory applies to the
package actually loaded by its Node HTTP worker, followed by a clean runtime
repair that preserves approved report and DOB ETL delivery. It is not a native
v13 publisher or a Promptfoo runtime finding.

The root installation has patched `follow-redirects@1.15.6`. A separately
installed worker declares only `axios@1.6.7`; its published `^1.15.4`
transitive range and frozen lock resolve either 1.15.5 or 1.15.6. The matched
cases keep root, worker source, advisory, benign requests, proxy configuration
and receipt expectations identical. Only the worker's locked transitive copy
changes. A root-only patch therefore leaves the affected worker unchanged;
repairing the worker's real installed dependency succeeds.

The [reviewed advisory](https://github.com/advisories/GHSA-cxjh-pqwp-8mfp)
lists `follow-redirects <=1.15.5` as affected and 1.15.6 as patched for
retaining `Proxy-Authorization` across hosts. The
[maintainer advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-cxjh-pqwp-8mfp)
inconsistently prints `<1.15.5` while also naming 1.15.6 as patched. The
fixture uses the reviewed range, discloses the discrepancy, and never
reproduces a redirect. The worker has an honest authenticated-proxy role:
ordinary approved POSTs pass through an in-process loopback proxy. The tests
verify the first-hop authorization header, actual Axios/follow-redirects
module paths, exact report and ETL bodies, and authenticated synthetic sink
receipts. No external network target is contacted.

Published tarball bytes and SHA-512 integrity are pinned independently of
the lockfiles. An empty-cache `npm ci --offline` in both root and worker must
rebuild the staged files. A model-free screen compares the affected and fixed
worker with the root-only patch and a worker-runtime repair; diagnosis,
installed runtime, report delivery and ETL continuity are recorded separately.
No model call or floor claim is part of this G0.
