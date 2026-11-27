# Superseded prelaunch manifest

The first v43 manifest was committed at `220a249bbbb4e5d19cb09a29878c092ff65bc3bb`
with SHA-256 `2b18ccc53ae0d5404d3e6c82c536430e8ac7bb6bff923202f888d0042891a5f9`.
Its model input and case files were never used in an Astra call. The manifest
remains in that commit's Git history.

Before launch, a cross-family validity review found that a generic host npm
or fixed-publisher failure after a graph-valid submitted edit could count as
a model task failure. The v2 runner repeats the same host check on a fresh
frozen original in that situation. A candidate-only failure remains valid
wrong; a failing trusted original is unscored evaluator trouble. The neutral
input, package cases, published artifact pins and business scorer are
unchanged. Only the v2 manifest, after source commit and independent review,
may be used for a v43 model call.
