# Maintainer security notice used by this fixture

Source: [nodejs/undici GHSA-wqq4-5wpv-mx2g](https://github.com/nodejs/undici/security/advisories/GHSA-wqq4-5wpv-mx2g), published October 12, 2023. CVE-2023-45143.

The notice covers the **npm `undici` package** below version **5.26.2**. Version **5.26.2** and later are patched for this advisory. In affected releases, the `fetch` implementation can retain a manually supplied Cookie header during a cross-origin redirect. Whether the issue applies to a particular service depends on the package actually loaded by its publication entry point and its use of Cookie-bearing requests; a package-lock entry elsewhere does not establish runtime use. This benchmark does not reproduce a redirect or attack.

The requested maintenance outcome is to identify whether this notice applies to the running publication client and, when it does, make a clean rebuild load a release unaffected by **this advisory** while approved publication and DOB ETL still complete. A client that already loads an unaffected release should preserve those business outcomes without an unnecessary disruption. This notice does not assert that a given release is free of every later advisory.
