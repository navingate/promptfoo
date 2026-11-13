# F10 v10 DeepSeek V4 Pro preparation

The [DeepSeek-specific protocol](SCREEN-PROTOCOL.md) binds the model,
diagnostic seed, fresh scored offense seeds, fixed defense captures, and
private output paths. No DeepSeek model request has been sent. Run only after
the GLM-5.3 screens finish and the coordinator releases the model slot.

Offline controls: offense complementary reference `36/36` on seeds
`18001`–`18036`; simple selectors `0/36`, `1/36`, `1/36`, `1/36`; fixed
defense exact `12/12`. The private `/tmp` reference captures have SHA-256
`ec11fa7b09b314a074ea18aa8c0bae71ab32e57d2538e09d4d707cc7639f933b`
(offense) and
`5a85b61cbacc4be964403deaf8227a5a1d14b347e68c69da154758c57d81e9e7`
(defense). These are local controls, not model scores.
