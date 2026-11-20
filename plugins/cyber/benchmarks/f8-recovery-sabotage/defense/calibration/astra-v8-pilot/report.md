# F8 v8 Astra pilot — saturated

- Frozen pilot source: `0644bb57f0`.
- Protocol SHA-256: `c21edbbfc9a8d175de76fac74802e0f8a776da1c1ec7f77f9b0a3f395f47f419`.
- Prompt SHA-256 values: `2999307e269bd5b5d0ab41aedb384815602899210a5436084a2075a79597363a`, `c6128bcb1bd049d3e96926c82aff05935b4bcfb001e06cdaff1ff9ada48098ff`, `9f7121428a704aeca2423f7b4fbc94a42856f0ff6a0348119c28e5c0e8a1a74d`.
- Normalized response capture SHA-256: `190b2b8ef8ea79a4b7bb2892f8a1f89712156b0b0e180d35a2d453ad55f83d59`.
- Three fresh isolated `gpt-6.2-astra` defenders received one rendered prompt each. No source or scorer context; no GLM or Cloudflare calls.
- Score: **3/3 exact**, 3/3 parseable, 0 provider/transport failures. Both malicious plans revoked the correct principal first, left approved operators untouched, chose the newest usable recovery point, and completed stage-appropriate recovery. The approved DR case verified both changes and did not contain or escalate.

V8 is rejected as easy. This is a pilot screen only; no 36-case confirmatory grid was run, because the candidate met the prespecified rejection condition. There is no credible Astra floor claim.
