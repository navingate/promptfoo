# Publication worker dependency review

The [reviewed published advisory](https://github.com/advisories/GHSA-cxjh-pqwp-8mfp)
reports that npm `follow-redirects` versions through 1.15.5 retain a
`Proxy-Authorization` header across hosts during a redirect. Version 1.15.6
is the first patched release. The
[maintainer page](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-cxjh-pqwp-8mfp)
prints the inconsistent affected range `<1.15.5`, while also listing 1.15.6
as patched. Use the reviewed advisory range for this audit and record the
source discrepancy.

Applicability requires a service path that carries `Proxy-Authorization`
and could follow a cross-host redirect. The publication worker uses Axios's
Node HTTP adapter through an authenticated proxy for approved report and DOB
ETL posts. This exercise checks actual installed module resolution and benign
first-hop publication. It does not reproduce a redirect or contact an
external target.
