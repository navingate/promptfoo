# F8 v24 historical Velero release G0

## Historical boundary

[GO-2026-4918](https://pkg.go.dev/vuln/GO-2026-4918), published 2026-05-07, lists `golang.org/x/net/http2` before v0.53.0 as affected. The [Velero v1.18.1 release](https://github.com/velero-io/velero/releases/tag/v1.18.1) followed on 2026-05-19. Tag commit `26ef8fa7df68dfa9ab8aa4669b8ac47340b0c510` has root x/net v0.53.0, but its [Dockerfile](https://github.com/velero-io/velero/blob/v1.18.1/Dockerfile) builds a separate Restic helper. The tagged [build script](https://github.com/velero-io/velero/blob/v1.18.1/hack/build-restic.sh) fresh-clones Restic v0.15.0 and applies [a checked-in module patch](https://github.com/velero-io/velero/blob/v1.18.1/hack/fix_restic_cve.txt) that selects x/net v0.48.0. The immutable released linux/amd64 manifest is `sha256:2752a01188bd8f16572a76b3b2c4331a6a5337a5cbe65715c22ac7f91b31bfa8` under OCI index `sha256:11459094b1b21ec7c817b08f8067d9e89380835547915cac9c4132ff05b55b90`. I verified the layer hashes, extracted the actual binaries, and read Go build metadata: `/velero` SHA `97d1b52641df2fcafbe879c3bdb38cf2553a99383f66c74d4909d1165a684b4e` embeds x/net v0.53.0; `/usr/bin/restic` SHA `8d7a380b1f73e42b0b58ad9ad858b1dc2862b9d293717c60bdf6771baff9ce42` embeds v0.48.0. This supports shipped-module applicability, **not** proven exploit reachability.

The [v1.18 file-system-backup documentation](https://velero.io/docs/v1.18/file-system-backup/) says restores from earlier Restic backups remain supported. The benchmark's one-file local Restic repository is a benign continuity check, not a Kubernetes node-agent integration test.

## Actual tagged release replay

The [screen](f8-v24-velero-g0-screen.json) records four full linux/amd64 image outcomes. Each run used the tagged Dockerfile, its fresh Restic clone, both builder stages and final packaging; it did not repair a host artifact after the image was built.

| Source state | Final image ID | Packaged Restic x/net | Main binary | Benign restore |
| --- | --- | --- | --- | --- |
| Public tag unchanged | `sha256:7fd8fe64…` | v0.48.0 | published SHA, client command exit 0 | exit 0, exact digest |
| Root `go.mod` commentary only | `sha256:7fd8fe64…` | v0.48.0 | published SHA, client command exit 0 | exit 0, exact digest |
| Visible-only source repair in tagged release script | `sha256:58f946b4…` | v0.53.0 | published SHA, client command exit 0 | exit 0, exact digest |
| Authored already-patched control source, no responder edit | `sha256:58f946b4…` | v0.53.0 | published SHA, client command exit 0 | exit 0, exact digest |

The root-only negative control is deliberately narrow: root `go.mod` already selected the advisory-fixed version at this tag, so its added comment asserts that fact but cannot change the separate helper. It does not claim to evaluate a root dependency upgrade on a different tag. The visible reference inspected the current image, ordinary source files, Dockerfile, build script and module patch through the same JSON interface planned for the model; it inserted a fixed-version module selection **in the versioned script after the patch is applied**. The script then recloned Restic and produced the fixed helper. Its saved full tool interaction SHA is `5e561785b7916106f725ac874589c1b315d660ffb398d054408a7f4be5ba0290`; the authored fixed-control no-op interaction SHA is `292413e7ae6b344a380335368ecfcc68a3103dc9f6ae1febe87f0e3455aa091e`. The private local originals remain in `/private/tmp/f8-v24-visible-reference.json` and `/private/tmp/f8-v24-visible-control.json` for audit, outside the model observation and pushed evidence.

The source and restored file SHA are both `8a6d850e346dafc428dc86a9f3e258ea2a72db0265601012a98c9bed4469707f`. The packaged repaired helper SHA is `57d09bdb6cbeea396fbf65b4147bacf46482d85e637395050f73a492d7db5f51`; the main binary remained byte-identical. The separately produced fixed-source overlay at `42df32071d85d608c9811880c9855cbba56dfe1bd68a9b3adaaf6910b6f7508f` and its current image are **authored controls**, never claimed as a Velero historical release.

## Interface and remaining gate

The neutral ticket names the public advisory and asks to preserve supported recovery operations. It does not name Restic, the stale binary, patch path, source mechanism or solution. Ordinary current-image inspection is per arm: the historical case uses the real v1.18.1 image; the control uses its corresponding authored rebuilt image. Generic binary lists and full selected module metadata are available through an invoked tool. Source list/search/read, exact source edits, and normal tagged build/readback are available. Private score and case labels are absent from each model observation.

Automatic Docker execution is fail-closed to no change, a hash-checked module-only patch, or the exact fixed-module insertion in the public release script. Other plausible executable changes are held for manual safety and equivalence review, not scored wrong. The build context contains public source and submitted edits, without host secrets or private findings. The tagged script still needs public GitHub and Go module downloads; a hard network allowlist is not established. Docker/network failures require a trusted baseline fault check and remain outside model denominators.

G0 has **zero Astra calls**. The next step is an independently reviewed blind freeze of exact prompt, source/image inventories, runner, score and retry rules. A small pilot can measure this distribution but cannot establish a 36-case floor.
