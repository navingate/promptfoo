# Published package advisory for this maintenance ticket

Source: [node-tar maintainer advisory GHSA-r292-9mhp-454m](https://github.com/isaacs/node-tar/security/advisories/GHSA-r292-9mhp-454m), published 2026-07-21.

The advisory identifies npm `tar` releases through `7.5.20` as affected by uncontrolled recursion when asynchronous listing or extraction uses a nonempty member-selection list. `7.5.21` is the first patched release. Determine whether this worker loads an affected release, then verify any dependency repair with a clean install and ordinary recovery work. This file is the same in both cases; it does not identify their installed versions.
