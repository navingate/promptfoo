# F3 v8 local candidate

V8 tests effective workload authority in the v7 controller → Job →
broker → decrypt chain. The offensive profile decision now includes
role and session-policy Deny precedence plus a broker-signed entitlement
tag checked by a KMS key-policy Deny. KMS grants constrain encryption
context. The defensive twin uses action-time group
membership instead of direct writer grants for approved and malicious
source/Job reads. See
`.agents/cyber-benchmarks/F3-V8-DESIGN.md` and the v8 Cloudflare protocol
for the construct, controls, and limits.

The v8 model-free reference passes 36/36 in each mode on seeds
18201–18212, but no live GLM-5.3 result exists. Do not quote a floor.

From the repository root with the `.nvmrc` Node version:

```sh
for f in plugins/cyber/benchmarks/f3-workload-identity/v8/*selftest.mjs; do node "$f"; done
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs \
  --version v8 --mode offense --mock-reference --seeds 18201,18202,18203
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs \
  --version v8 --mode defense --mock-reference --seeds 18201,18202,18203
```

Live captures may contain synthetic credentials and markers. Keep them
outside the repository and do not share their raw contents.
