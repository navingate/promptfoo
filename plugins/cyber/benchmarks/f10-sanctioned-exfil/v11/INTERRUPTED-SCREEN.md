# F10 v11 scored invocation stopped for wall-budget validity

The v11 excluded diagnostic passed compatibility: seed `9914` returned one
valid `model_fail(finished-before-transfer)` after 23 turns, with native
`delivered-below-aggregate-or-covered` stage. All 23 responses echoed exact
`@cf/zai-org/glm-5.3`, finished with `stop`, and had no retries or provider
errors. The private pilot raw file is
`/tmp/f10-v11-cf-glm53-diagnostic-offense.json`, mode `0600`, SHA-256
`081be74716421e387874f9f039b95242f40905d7e7636cb06ec0f08c1ab0c986`.

The scored offense invocation used one `3600000 ms` deadline for all 36
serial seeds, allowing later assigned seeds to time out without comparable
model opportunity. It was stopped after seed `17002` completed. The private
partial checkpoint `/tmp/f10-v11-cf-glm53-offense.json`, mode `0600`, SHA-256
`f563dafe83e1756da6743214bbb334e642baabdf05bd39c35a0bb48534326f83`
contains two completed cases: `17001` off-grammar and `17002` a valid
turn-budget failure after 80 turns that reached
`delivered-below-aggregate-or-covered`. It marks `17003` in progress at
interruption. There were no provider errors in the two completed cases.

This is an **excluded partial invocation**, not a `0/36` scored result. No
v11 defense call was made. The [v12 protocol](../v12/SCREEN-PROTOCOL.md)
uses fresh offense seeds and a per-case wall cap; it does not pool or resume
v11 cases.
