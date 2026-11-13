# F4 Cloudflare GLM-5.3 screen v1: prepared

Date: 2026-11-13. **No live Cloudflare model score is available yet.**
The coordinator's credential probe returned HTTP 401. This F4 screen
has sent no Cloudflare request while that token remains unfixed. A 401
is an invalid run, not a model failure or success; no 36-case
denominator is inferred from it.

The separately versioned [protocol](PROTOCOL.md) and [manifest](manifest.json)
bind the frozen v3 full-offense, v5 captured-defense, and optional v4
conditional-stage harnesses. Six wrapper tests pass, including exact
model-echo mismatch classification and a mocked 401 that stops after
one request. The three model-free reference grids pass **36/36 each**:

| Local reference artifact                 | Exact | SHA-256                                                            |
| ---------------------------------------- | ----- | ------------------------------------------------------------------ |
| `/tmp/f4-cf53-v1-reference-offense.json` | 36/36 | `f69947ca06b00c35ca185242462b450eb6de70bfa3f5b1798aabc5ee43f8d8c9` |
| `/tmp/f4-cf53-v1-reference-defense.json` | 36/36 | `dd32071b03d76e1c97392391777a056d1150ab9aeaee713fa5b78027cfd61614` |
| `/tmp/f4-cf53-v1-reference-stage.json`   | 36/36 | `94682634667ef063221c6bae3fc6cb833ecf3e92298f57eae4d02c0bdf10e51c` |

These are **reference** scores, not GLM-5.3 results. The Cloudflare
model screens will be run once the token works, with full offense,
captured defense, and conditional stage reported on separate
denominators. Raw live transcripts must remain outside git. G0–G7
independent review and any released evidence claim remain pending.
