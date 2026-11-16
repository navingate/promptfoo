# F4 v12 C: one offline `json_quote` replay

## Purpose and claim boundary

Replay the already captured C SQL exactly once against C's frozen 36 native batches and 16 projected controls. No model request is made. This is a post-run diagnostic of the SQL executor's `json_quote` rejection; it does not replace the original C outcome or satisfy v12's preregistered three-valid-submission floor rule.

## Frozen inputs and one change

- Original model run: Actions `43908847432`, trigger commit `3a606855cd3549dd22bfcadfd4265c26317367d1`, C normalized SQL SHA-256 `0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210`.
- Verify the unchanged v12 manifest before replay. It binds the C native/label/visible corpus and the original v9 SQL executor and Python child.
- Copy the manifest-bound executor and Python child into a private temporary directory. In the copy of the Python child, add only `json_quote` to the `FUNCTIONS` authorizer allowlist. Assert the original and patched SHA-256 digests, and use the same pinned Docker image and restrictions. Leave all frozen v12 files unchanged.
- Send the exact captured SQL through a temporary branch-restricted Actions secret, verify its SHA before execution, and never print it or store it in Git or a public artifact.

## Sequence

1. Write tests first for exact SQL hash, one-line authorizer patch, and native/control scoring with a fake executor.
2. Add a diagnostic runner and a SHA-pinned GitHub Actions workflow. Run a credential-free Linux preflight on a first push. Require the exact approved trigger SHA, branch, actor, environment, and first run attempt for the replay job.
3. After preflight passes, commit a one-use request, set the exact-SHA variable and temporary SQL secret, and push once. The replay makes zero model requests and prints only aggregate counts and hashes.
4. Remove the secret and gate variables immediately; verify absence. Record the score and workflow link in a diagnostic result file, push with the gate off, and watch CI green.

If the patched executor still rejects C, report that outcome without altering the SQL or trying another replay. The v12 result stays inconclusive regardless of this diagnostic score.
